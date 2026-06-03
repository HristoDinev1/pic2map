import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const r = Router();

// Registration / login / password reset are handled by Cognito Hosted UI /
// the Amplify SDK on the frontend. This endpoint returns the synced profile
// for the currently authenticated token.
r.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default r;
