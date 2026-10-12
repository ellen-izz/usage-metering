import express from "express";

const app = express();
const port = 8080;

app.use(express.json());

app.get("/api/healthz", (_req, res) => {
    res.status(200).send("OK");
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});