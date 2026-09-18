import cors from 'cors'

// Both release routers share this policy: the import router sees preflights
// first, including those for management GET/PATCH routes.
const origins = new Set([
    'https://pixelversestudios.io',
    'https://www.pixelversestudios.io',
    ...(process.env.PVS_DASHBOARD_ORIGINS || '')
        .split(',').map(value => value.trim()).filter(Boolean)
])

export const adminReleaseCors = cors({
    origin: (origin, callback) => callback(null, !origin || origins.has(origin)),
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'X-Request-Id'],
    exposedHeaders: ['ETag', 'X-Release-ETag', 'X-Request-Id'],
    maxAge: 600
})
