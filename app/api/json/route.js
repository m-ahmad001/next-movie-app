import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import prisma from "@/lib/prisma";

export const POST = async (req) => {
  const filePath = path.join(process.cwd(), "movieJson", "movie_links18.json");
  const fileContents = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(fileContents);

  const links = await prisma.movieLinks.createMany({
    data: data.map((item) => ({
      url: item.url,
    })),
    skipDuplicates: true,
  });
  return NextResponse.json(links);
};
