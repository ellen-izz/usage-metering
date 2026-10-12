import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { accounts } from "./db/schema.js";


export function getAPIKey(req: Request): string {
    const authHeader = req.get("Authorization");

    if (!authHeader) {
        throw new Error("Missing Authorization header");
    }

    const [scheme, key] = authHeader.split(" ");

    if (scheme !== "ApiKey" || !key || authHeader.split(" ").length !== 2) {
        throw new Error("Invalid Authorization header");
    }

    return key;
}

export const authenticateAccount: RequestHandler = async (req, res, next) => {
    let apiKey: string;

    try {
        apiKey = getAPIKey(req);
    } catch (error: unknown) {
        const message =
            error instanceof Error ? error.message : "Unauthorized";

        res.status(401).json({ error: message });
        return;
    }

    const apiKeyHash = createHash("sha256")
        .update(apiKey)
        .digest("hex");

    try {
        const [account] = await db
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.apiKeyHash, apiKeyHash))
            .limit(1);

        if (!account) {
            res.status(401).json({ error: "Invalid API key" });
            return;
        }

        res.locals.accountId = account.id;
        next();
    } catch (error: unknown) {
        console.error("Account authentication failed:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};