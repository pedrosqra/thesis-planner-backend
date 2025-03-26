import { Request, Response, NextFunction, RequestHandler } from "express"; // Include NextFunction for better type safety
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import User, { IUser } from "../models/User"; 

const generateToken = (userId: string) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET as string, { expiresIn: "1h" });
};

// Register a new user
export const registerUser: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      res.status(400).json({ message: "All fields are required." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(400).json({ message: "User already exists." });
    }

    const user = new User({ username, email, password });
    await user.save();

    res.status(201).json({ message: "User registered successfully!" });
  } catch (error) {
    next(error); // Use next() for error handling
  }
};

// Login user
export const loginUser: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
			console.log("Login attempt:", req.body); // Log request data    
      const { email, password } = req.body;
  
      const user = await User.findOne({ email }) as IUser | null; // 👈 Explicitly type user
			console.log("User found:", user); // Log user data from DB

      if (!user) {
        res.status(400).json({ message: "Invalid credentials." });
        return;
      }
  
      const isMatch = await user.comparePassword(password);
			console.log("Password match:", isMatch); // Log password comparison
      if (!isMatch) {
        res.status(400).json({ message: "Invalid credentials." });
        return;
      }
  
      const token = generateToken(user._id.toString());
		
			// 🏆 Set the token as an HTTP-only cookie
			res.cookie("token", token, {
				httpOnly: true, // Prevents JavaScript access
				secure: process.env.NODE_ENV === "production", // Enable secure flag in production
				sameSite: "strict", // Helps prevent CSRF attacks
				maxAge: 3600000 // 1 hour expiration
			});

			res.json({ message: "Login successful" });
  
    } catch (error) {
      res.status(500).json({ message: "Server error", error });
    }
};

// Logout user
export const logoutUser: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  res.clearCookie("token"); // ✅ Clears token cookie
  res.json({ message: "User logged out successfully!" })
};




