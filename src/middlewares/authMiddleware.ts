import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  user?: string; // Store user ID here
}

// Middleware to authenticate user
export const authenticateUser: RequestHandler = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.cookies.token; // Get token from cookies

  if (!token) {
    res.status(401).json({ message: "Not authorized, token missing" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string };
    req.user = decoded.id; // Attach user ID to request
    next();
  } catch (error) {
    res.status(401).json({ message: "Not authorized, token invalid" });
  }
};
