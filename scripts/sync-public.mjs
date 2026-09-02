import { cpSync, mkdirSync } from "node:fs";

mkdirSync("public/charts", { recursive: true });
mkdirSync("public/data", { recursive: true });
cpSync("static/charts", "public/charts", { recursive: true });
cpSync("data/tweets.json", "public/data/tweets.json");
cpSync("data/universe.csv", "public/data/universe.csv");
