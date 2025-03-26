import mongoose, { Schema, Document } from "mongoose";

export interface IThesis extends Document {
  title: string;
  description: string;
  user: mongoose.Types.ObjectId;
  status: "draft" | "in progress" | "completed";
  roadmap: {
    stepNumber: number;
    title: string;
    details: string;
  }[];
  relatedPapers: {
    title: string;
    author: string;
    link?: string;
  }[];
  timeline: {
    milestone: string;
    dueDate: Date;
  }[];
  createdAt: Date;
}

const ThesisSchema = new Schema<IThesis>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["draft", "in progress", "completed"],
      default: "draft",
    },
    roadmap: [
      {
        stepNumber: { type: Number, required: true },
        title: { type: String, required: true },
        details: { type: String, required: true },
      },
    ],
    relatedPapers: [
      {
        title: { type: String, required: true },
        author: { type: String, required: true },
        link: { type: String },
      },
    ],
    timeline: [
      {
        milestone: { type: String, required: true },
        dueDate: { type: Date, required: true },
      },
    ],
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model<IThesis>("Thesis", ThesisSchema);
