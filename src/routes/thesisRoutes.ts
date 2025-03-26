import express from "express";
import { createThesisRoadmap } from "../controllers/thesisController";

const router = express.Router();

router.post("/generate", createThesisRoadmap);

export default router;
