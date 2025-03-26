import express, { Request, Response } from "express";
import { registerUser, loginUser, logoutUser } from "../controllers/authController";
import { authenticateUser, AuthRequest } from "../middlewares/authMiddleware"; // ✅ Import both

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);

// ✅ Fix protected route
router.get("/protected", authenticateUser, (req: Request, res: Response) => {
  const authReq = req as AuthRequest; // 👈 Type assertion
  res.json({ message: "You have accessed a protected route!", userId: authReq.user });
});

export default router;
