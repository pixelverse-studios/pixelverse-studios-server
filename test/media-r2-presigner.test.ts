import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { describe, expect, it } from 'vitest'

describe('R2 presigner options', () => {
    it('signs content headers without adding empty-body checksum params', async () => {
        const client = new S3Client({
            region: 'auto',
            endpoint: 'https://test-account.r2.cloudflarestorage.com',
            requestChecksumCalculation: 'WHEN_REQUIRED',
            credentials: {
                accessKeyId: 'test-access-key',
                secretAccessKey: 'test-secret-key',
            },
        })
        const command = new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: 'events/test.jpg',
            ContentType: 'image/jpeg',
            ContentLength: 123456,
        })

        const signedUrl = await getSignedUrl(client, command, {
            expiresIn: 900,
            signableHeaders: new Set(['content-type', 'content-length']),
        })

        const url = new URL(signedUrl)

        expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
            'content-length;content-type;host'
        )
        expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false)
        expect(url.searchParams.has('x-amz-sdk-checksum-algorithm')).toBe(false)
    })
})
