import { Request, Response } from "express";
import { generateThesisRoadmap } from "../utils/generateThesisRoadmap";

export const createThesisRoadmap = async (req: Request, res: Response): Promise<void> => {
  try {
    const { thesisDescription } = req.body;

    if (!thesisDescription) {
      res.status(400).json({ message: "Thesis description is required" });
      return;
    }

    const roadmap = await generateThesisRoadmap(thesisDescription);

    res.json({ roadmap }); // ✅ No need to return Response explicitly
  } catch (error) {
    console.error("Error generating thesis roadmap:", error);
    res.status(500).json({ message: "Failed to generate thesis roadmap" });
  }
};
