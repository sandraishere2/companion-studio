// middleware/requireAuth.js
//
// TEMPORARY placeholder. Real auth (Supabase session/JWT check) needs to
// replace this before going live — right now it lets every request through
// as a fake logged-in test user, so the billing routes have a req.user to
// work with while you're still building.
//
// Replace the contents of this function with real logic that:
//   1. Reads the user's session/token from the request
//   2. Looks up the user (e.g. via Supabase)
//   3. Sets req.user = { id, email, stripeCustomerId }
//   4. Calls next() only if the user is authenticated

module.exports = function requireAuth(req, res, next) {
  req.user = {
    id: 'temp-test-user-id',
    email: 'test-user@example.com',
    stripeCustomerId: null, // will be created automatically on first checkout
  };
  next();
};
