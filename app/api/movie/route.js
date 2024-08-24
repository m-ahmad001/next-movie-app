import prisma from "@/lib/prisma";
import axios from "axios";
import * as cheerio from "cheerio";
import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    // add pagination to get movies, 20 at a time,count get from query
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page")) || 1;
    const perPage = parseInt(searchParams.get("perPage")) || 20;
    const count = await prisma.movie.count();
    const totalPages = Math.ceil(count / perPage);

    const movies = await prisma.movie.findMany({
      skip: (page - 1) * perPage,
      take: perPage,
    });
    return NextResponse.json({ movies, totalPages, count });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const movies = await prisma.movieLinks.findMany({
      take: 40,
      where: { isScraped: false },
      orderBy: { id: "desc" },
    });

    if (movies.length === 0) {
      return NextResponse.json(
        { message: "No new movies to scrape" },
        { status: 200 }
      );
    }

    const results = await Promise.all(
      movies.map(async (movie) => {
        try {
          const slug = movie.url.split("/").slice(-2, -1)[0];
          const isAlreadyScraped = await prisma.movie.findUnique({
            where: { slug },
          });

          if (isAlreadyScraped) {
            await prisma.movieLinks.update({
              where: { id: movie.id },
              data: { isScraped: true },
            });
            return {
              status: "skipped",
              message: "Movie already scraped",
              url: movie.url,
            };
          }

          const movieData = await scrapeMovieData(movie.url);
          if (!movieData) {
            return {
              status: "failed",
              message: "Failed to scrape data",
              url: movie.url,
            };
          }

          await saveMovieData(movieData);
          await prisma.movieLinks.update({
            where: { id: movie.id },
            data: { isScraped: true },
          });

          return {
            status: "success",
            message: "Movie data saved successfully",
            url: movie.url,
          };
        } catch (error) {
          console.error(`Error processing movie ${movie.url}:`, error);
          return { status: "error", message: error.message, url: movie.url };
        }
      })
    );

    const summary = results.reduce((acc, result) => {
      acc[result.status] = (acc[result.status] || 0) + 1;
      return acc;
    }, {});

    // If there are more movies to scrape, trigger another scraping process after a 5-second delay
    if (results.length === 40) {
      setTimeout(async () => {
        await POST(request); // Re-trigger the POST function
      }, 7000);
    }

    return NextResponse.json({
      message: "Movie scraping process completed",
      summary,
      details: results,
      continueScraping: results.length === 40,
    });
  } catch (error) {
    console.error("Error in POST request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
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
