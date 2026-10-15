
import express from "express";
import { router } from "./routes.js";

export const app = express();

app.use(express.json());

app.get("/api/healthz", (_req, res) => {
    res.status(200).send("OK");
});

app.use("/api", router);
