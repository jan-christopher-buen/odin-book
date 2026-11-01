import passport from 'passport'
import { Strategy } from 'passport-local'
import bcrypt from 'bcrypt'
import { db, publicUser } from './db.js'

passport.use(
  new Strategy(async (username, password, done) => {
    try {
      const user = await db.user.findUnique({
        where: { username: String(username).trim().toLowerCase() },
      })
      const valid = await bcrypt.compare(
        password,
        user?.passwordHash ??
          '$2b$12$C6UzMDM.H6dfI/f/IKcEe.ydwY8HfNhV.bI.BhWW5xQjR3p8gKz6K',
      )
      done(null, valid && user ? user : false)
    } catch (error) {
      done(error)
    }
  }),
)
passport.serializeUser((user, done) => done(null, user.id))
passport.deserializeUser(async (id, done) => {
  try {
    done(null, await db.user.findUnique({ where: { id }, select: publicUser }))
  } catch (error) {
    done(error)
  }
})
export const authenticated = (req, res, next) => {
  if (!req.user && !req.session.guest)
    return res.status(401).json({ error: 'Please sign in to continue.' })
  next()
}
export const member = (req, res, next) => {
  if (!req.user)
    return res
      .status(403)
      .json({ error: 'Guests can browse. Create an account to join in.' })
  next()
}
export default passport
