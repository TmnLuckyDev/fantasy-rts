const productionBackend = 'https://ash-and-iron.onrender.com'

export function mobileBackend(configured?: string) {
  const url = new URL(configured || productionBackend)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_MOBILE_SERVER_URL must be an HTTPS origin, such as https://ash-and-iron.onrender.com.')
  }
  return url.origin
}

export function socketUrl(page: string, backend?: string) {
  const url = new URL('/socket', backend ?? page)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

export function inviteUrl(page: string, code: string, backend?: string) {
  const url = backend ? new URL('/', backend) : new URL(new URL(page).pathname, page)
  url.searchParams.set('room', code)
  return url
}
