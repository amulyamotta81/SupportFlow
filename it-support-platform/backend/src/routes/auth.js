import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );
    const userData = await User.findById(user._id).select('-password');
    res.json({ token, user: userData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    if (await User.findOne({ email })) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    const user = await User.create({ email, password, name, role: role || 'employee' });
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );
    const userData = await User.findById(user._id).select('-password');
    res.status(201).json({ token, user: userData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authenticate, async (req, res) => {
  res.json(req.user);
});

export default router;
