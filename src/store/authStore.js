// Tiny observable store for the signed-in user + memberships (Layer 1 auth only).

const listeners = new Set()

const state = {
  user: null,        // { uid, email, displayName }
  memberships: [],   // organization_memberships rows for this user
  activeOrg: null,   // organization_id
  activeOrgName: '',
  ready: false,
}

export const authStore = {
  getState() {
    return state
  },
  setState(patch) {
    Object.assign(state, patch)
    listeners.forEach((fn) => {
      try { fn(state) } catch (e) { console.warn(e) }
    })
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
