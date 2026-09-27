import { LoginView } from './LoginView.js'

// /register reuses the unified auth screen (same page, no flip) —
// it simply opens on the "Create" tab. "Join" lives on the same
// screen as the second tab.
export async function RegisterView(app) {
  return LoginView(app, { initial: 'create' })
}
