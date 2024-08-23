import axios from "axios";
import * as cheerio from "cheerio";
import prisma from "@/lib/prisma";
import redis from "@/lib/redis";
import { faker } from "@faker-js/faker";
import { NextResponse } from "next/server";
import useSWR from "swr";

export async function POST(request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }
    console.time("Scraping time");
    const isAlreadyScraped = await prisma.movie.findUnique({
      where: { slug: url.split("/").slice(-2, -1)[0] },
    });

    if (isAlreadyScraped) {
      return NextResponse.json(
        { error: "Movie already scraped" },
        { status: 400 }
      );
    }

    console.time("Scraping time");
    const movieData = await scrapeMovieData(url);
    console.timeEnd("Scraping time");
    if (!movieData) {
      return NextResponse.json(
        { error: "Failed to scrape data" },
        { status: 500 }
      );
    }

    console.time("Saving time");
    await saveMovieData(movieData);
    console.timeEnd("Saving time");

    return NextResponse.json(
      { message: "Movie data saved successfully" },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error in POST request:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const movies = await prisma.movie.findMany();
    return NextResponse.json(movies);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
// Functions
async function scrapeMovieData(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    // Extract movie details

    const slug = $('link[rel="canonical"]')
      .attr("href")
      .split("/")
      .slice(-2, -1)[0];

    const title = $('h1[itemprop="name"]').text().trim();
    const description = $('div[itemprop="description"] > div.singcont')
      .text()
      .trim();
    const image_url = $('img[itemprop="image"]').attr("src");
    const author = $('meta[name="author"]').attr("content");
    const published_date = $('meta[itemprop="datePublished"]').attr("content");
    const modified_date =
      $('meta[itemprop="dateModified"]').attr("content") ||
      new Date().toISOString();
    const views = parseInt(
      $('span[itemprop="interactionCount"]')
        .text()
        .replace(/[^0-9]/g, "")
    );

    // Extract video URLs
    const video_urls = [];
    $("iframe").each((i, element) => {
      video_urls.push($(element).attr("data-src") || $(element).attr("src"));
    });

    // Extract download URLs
    const download_urls = {};
    $('h2:contains("Quality Links")').each((i, element) => {
      const quality = $(element).text().trim().split(" ")[1];
      const provider = $(element).text().trim().split(" ")[3];
      const links = [];
      $(element)
        .next()
        .find("a")
        .each((j, link) => {
          links.push($(link).attr("href"));
        });
      download_urls[`${provider}_${quality}`] = links;
    });

    // Extract genres
    const genres = [];
    $('.rightinfo > p:first-child a[itemprop="genre"]').each((i, element) => {
      genres.push($(element).text().trim());
    });

    // Extract tags
    const tags = [];
    $('.rightinfo .tags a[rel="tag"]').each((i, element) => {
      tags.push($(element).text().trim());
    });

    // Director and duration not present in the HTML
    const director = "N/A";
    const duration = "N/A";

    const movieData = {
      slug,
      title,
      description,
      image_url,
      author,
      published_date,
      modified_date,
      views,
      video_urls,
      download_urls,
      genre: genres,
      tag: tags,
      director,
      duration,
    };

    return movieData;
  } catch (error) {
    console.error(`Error scraping data from ${url}:`, error);
    return null;
  }
}

async function saveMovieData(movieData) {
  try {
    const categoryPromises = await Promise.all(
      movieData.genre.map(async (genre) => {
        return prisma.category.upsert({
          where: { name: genre },
          update: {},
          create: { name: genre },
        });
      })
    );

    // Create or find tags
    const tagPromises = await Promise.all(
      movieData.tag.map(async (tagName) => {
        return prisma.tag.upsert({
          where: { name: tagName },
          update: {},
          create: { name: tagName },
        });
      })
    );

    // Create or update the movie with references to categories and tags
    await prisma.movie.create({
      data: {
        slug: movieData.slug,
        title: movieData.title,
        description: movieData.description,
        image_url: movieData.image_url,
        author: movieData.author,
        published_date: movieData.published_date,
        modified_date: movieData.modified_date,
        views: movieData.views,
        video_urls: movieData.video_urls,
        download_urls: movieData.download_urls,
        director: movieData.director,
        duration: movieData.duration,
        categories: {
          connect: categoryPromises.map((category) => ({ id: category.id })),
        },
        tags: {
          connect: tagPromises.map((tag) => ({ id: tag.id })),
        },
      },
    });

    console.log(`Movie "${movieData.title}" saved successfully!`);
  } catch (error) {
    if (error.code === "P2002") {
      throw new Error(`Duplicate slug found for "${movieData.title}"`);
    } else {
      throw new Error(error.message);
    }
  }
}
