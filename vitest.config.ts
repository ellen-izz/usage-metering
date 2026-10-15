
import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";

const testEnv = parse(readFileSync(".env.test"));

const databaseUrl = testEnv.DATABASE_URL;

if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing from .env.test");
}

const databaseName = new URL(databaseUrl).pathname.slice(1);

if (databaseName !== "usage_metering_test") {
    throw new Error(
        "Tests must use the usage_metering_test database!"
    );
}

export default defineConfig({
    test: {
        environment: "node",
        fileParallelism: false,
        maxWorkers: 1,
        env: {
            DATABASE_URL: databaseUrl,
        },
    },
});
