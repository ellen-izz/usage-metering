import express from "express";
import { router } from "./routes.js"

const app = express();
const port = 8080;

app.use(express.json());

app.get("/api/healthz", (_req, res) => {
    res.status(200).send("OK");
});

app.use("/api", router);




app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});