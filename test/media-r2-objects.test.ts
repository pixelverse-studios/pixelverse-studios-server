import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
    from: vi.fn(),
    send: vi.fn(),
    queryResults: [] as Array<{ data: unknown; error: unknown }>,
    builders: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
    commands: [] as Array<{ name: string; input: Record<string, unknown> }>,
    updateItem: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
    db: {
        from: mockState.from,
    },
    Tables: {
        WEBSITES: 'websites',
        MEDIA_R2_CONFIGS: 'media_r2_configs',
        MEDIA_CATALOG_ITEMS: 'media_catalog_items',
    },
    COLUMNS: {
        WEBSITE_SLUG: 'website_slug',
    },
}))

vi.mock('../src/services/media-catalog', () => ({
    default: {
        updateItem: mockState.updateItem,
    },
}))

vi.mock('@aws-sdk/client-s3', () => {
    class MockS3Client {
        send = mockState.send
    }

    const makeCommand =
        (name: string) =>
        class {
            input: Record<string, unknown>

            constructor(input: Record<string, unknown>) {
                this.input = input
                mockState.commands.push({ name, input })
            }
        }

    return {
        S3Client: MockS3Client,
        PutObjectCommand: makeCommand('PutObjectCommand'),
        ListObjectsV2Command: makeCommand('ListObjectsV2Command'),
        HeadObjectCommand: makeCommand('HeadObjectCommand'),
        CopyObjectCommand: makeCommand('CopyObjectCommand'),
        DeleteObjectCommand: makeCommand('DeleteObjectCommand'),
    }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: vi.fn(),
}))

import mediaR2Service from '../src/services/media-r2'

const makeQueryBuilder = (result: { data: unknown; error: unknown }) => {
    const builder = {
        select: vi.fn(),
        eq: vi.fn(),
        is: vi.fn(),
        neq: vi.fn(),
        maybeSingle: vi.fn(),
        update: vi.fn(),
        single: vi.fn(),
    }

    builder.select.mockReturnValue(builder)
    builder.eq.mockReturnValue(builder)
    builder.is.mockReturnValue(builder)
    builder.neq.mockReturnValue(builder)
    builder.update.mockReturnValue(builder)
    builder.maybeSingle.mockResolvedValue(result)
    builder.single.mockResolvedValue(result)

    return builder
}

const websiteRecord = {
    id: 'website-1',
    client_id: 'client-1',
}

const r2ConfigRecord = {
    bucket: 'iffers-pictures',
    public_base_url: 'https://pub.example.test',
    key_prefix: '',
}

const prefixedR2ConfigRecord = {
    ...r2ConfigRecord,
    key_prefix: 'clients/iffers-pictures',
}

const draftItem = {
    id: 10,
    website_id: 'website-1',
    client_id: 'client-1',
    key: 'events/baby-shower/source.jpg',
    filename: 'source.jpg',
    src: 'https://pub.example.test/events/baby-shower/source.jpg',
    alt: 'Source image',
    library: 'portfolio',
    site_category: null,
    service: 'Events',
    sub_category: 'Baby Shower',
    aspect_ratio: 'portrait',
    status: 'draft',
    sort_order: 0,
    created_at: '2026-05-27T12:00:00.000Z',
    updated_at: '2026-05-27T12:30:00.000Z',
    archived_at: null,
    archived_by: null,
    archived_from_status: null,
}

const prefixedDraftItem = {
    ...draftItem,
    key: 'clients/iffers-pictures/events/baby-shower/source.jpg',
    src: 'https://pub.example.test/clients/iffers-pictures/events/baby-shower/source.jpg',
}

const notFoundError = Object.assign(new Error('not found'), {
    name: 'NotFound',
    $metadata: { httpStatusCode: 404 },
})

describe('media R2 object operations', () => {
    beforeEach(() => {
        mockState.from.mockReset()
        mockState.send.mockReset()
        mockState.updateItem.mockReset()
        mockState.queryResults = []
        mockState.builders = []
        mockState.commands = []
        mockState.from.mockImplementation(() => {
            const builder = makeQueryBuilder(
                mockState.queryResults.shift() || { data: null, error: null }
            )
            mockState.builders.push(builder)
            return builder
        })
        process.env.R2_ACCESS_KEY_ID = 'test-access-key'
        process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key'
        process.env.R2_ACCOUNT_ID = 'test-account'
        process.env.R2_BUCKET_NAME = 'env-bucket'
        process.env.R2_PUBLIC_BASE_URL = 'https://env-public.example.test'
    })

    it('lists R2 objects under a safe prefix', async () => {
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: r2ConfigRecord, error: null },
        ]
        mockState.send.mockResolvedValue({
            Contents: [
                {
                    Key: 'events/baby-shower/image.jpg',
                    Size: 1234,
                    LastModified: new Date('2026-05-27T12:00:00.000Z'),
                    ETag: '"abc123"',
                },
            ],
        })

        const result = await mediaR2Service.listObjects({
            websiteSlug: 'iffers-pictures',
            prefix: '/events/baby-shower/',
        })

        expect(mockState.commands[0]).toEqual({
            name: 'ListObjectsV2Command',
            input: {
                Bucket: 'iffers-pictures',
                Prefix: 'events/baby-shower',
                MaxKeys: 1000,
            },
        })
        expect(result).toEqual({
            bucket: 'iffers-pictures',
            prefix: 'events/baby-shower',
            objects: [
                {
                    key: 'events/baby-shower/image.jpg',
                    public_url:
                        'https://pub.example.test/events/baby-shower/image.jpg',
                    size: 1234,
                    last_modified: '2026-05-27T12:00:00.000Z',
                    etag: 'abc123',
                },
            ],
        })
    })

    it('reports destination availability across catalog and R2', async () => {
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: r2ConfigRecord, error: null },
            { data: null, error: null },
        ]
        mockState.send.mockRejectedValueOnce(notFoundError)

        await expect(
            mediaR2Service.checkDestination({
                websiteSlug: 'iffers-pictures',
                destinationKey: 'events/baby-shower/new.jpg',
            })
        ).resolves.toEqual({
            destination_key: 'events/baby-shower/new.jpg',
            catalog_exists: false,
            r2_exists: false,
            available: true,
        })
    })

    it('maps R2 timeout failures to retryable upload timeout errors', async () => {
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: r2ConfigRecord, error: null },
        ]
        mockState.send.mockRejectedValueOnce(
            Object.assign(new Error('socket timed out'), {
                name: 'TimeoutError',
                code: 'ETIMEDOUT',
            })
        )

        await expect(
            mediaR2Service.listObjects({
                websiteSlug: 'iffers-pictures',
            })
        ).rejects.toMatchObject({
            status: 504,
            code: 'media.upload_timeout',
            retryable: true,
        })
    })

    it('maps R2 busy failures to retryable temporary unavailable errors', async () => {
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: r2ConfigRecord, error: null },
            { data: null, error: null },
        ]
        mockState.send.mockRejectedValueOnce(
            Object.assign(new Error('slow down'), {
                name: 'SlowDown',
                $metadata: {
                    httpStatusCode: 503,
                    httpHeaders: { 'retry-after': '3' },
                },
            })
        )

        await expect(
            mediaR2Service.checkDestination({
                websiteSlug: 'iffers-pictures',
                destinationKey: 'events/baby-shower/new.jpg',
            })
        ).rejects.toMatchObject({
            status: 503,
            code: 'media.upload_temporary_unavailable',
            retryable: true,
            details: expect.objectContaining({
                retry_after: '3',
            }),
        })
    })

    it('checks site image destination paths across catalog and R2', async () => {
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: r2ConfigRecord, error: null },
            { data: null, error: null },
        ]
        mockState.send.mockRejectedValueOnce(notFoundError)

        await expect(
            mediaR2Service.checkDestination({
                websiteSlug: 'iffers-pictures',
                destinationKey: 'site/about/jenn-portrait.jpg',
            })
        ).resolves.toEqual({
            destination_key: 'site/about/jenn-portrait.jpg',
            catalog_exists: false,
            r2_exists: false,
            available: true,
        })
        expect(mockState.commands[0]).toEqual({
            name: 'HeadObjectCommand',
            input: {
                Bucket: 'iffers-pictures',
                Key: 'site/about/jenn-portrait.jpg',
            },
        })
    })

    it('scopes list, destination checks, and moves to configured key prefixes', async () => {
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: prefixedR2ConfigRecord, error: null },
        ]
        mockState.send.mockResolvedValueOnce({
            Contents: [
                {
                    Key: 'clients/iffers-pictures/events/baby-shower/image.jpg',
                    Size: 1234,
                    LastModified: new Date('2026-05-27T12:00:00.000Z'),
                    ETag: '"abc123"',
                },
            ],
        })

        await expect(
            mediaR2Service.listObjects({
                websiteSlug: 'iffers-pictures',
                prefix: 'events/baby-shower',
            })
        ).resolves.toMatchObject({
            prefix: 'clients/iffers-pictures/events/baby-shower',
        })
        expect(mockState.commands[0]).toEqual({
            name: 'ListObjectsV2Command',
            input: {
                Bucket: 'iffers-pictures',
                Prefix: 'clients/iffers-pictures/events/baby-shower',
                MaxKeys: 1000,
            },
        })

        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: prefixedR2ConfigRecord, error: null },
            { data: null, error: null },
        ]
        mockState.send.mockRejectedValueOnce(notFoundError)

        await expect(
            mediaR2Service.checkDestination({
                websiteSlug: 'iffers-pictures',
                destinationKey: 'events/baby-shower/new.jpg',
            })
        ).resolves.toMatchObject({
            destination_key: 'clients/iffers-pictures/events/baby-shower/new.jpg',
            available: true,
        })

        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: prefixedR2ConfigRecord, error: null },
            { data: prefixedDraftItem, error: null },
            { data: null, error: null },
        ]
        mockState.send
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(notFoundError)
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
        mockState.updateItem.mockResolvedValue({
            id: 10,
            key: 'clients/iffers-pictures/events/baby-shower/new-name.jpg',
            filename: 'new-name.jpg',
            src: 'https://pub.example.test/clients/iffers-pictures/events/baby-shower/new-name.jpg',
            alt: 'Source image',
            service: 'Events',
            subCategory: 'Baby Shower',
            aspectRatio: 'portrait',
            status: 'draft',
            sortOrder: 0,
        })

        await expect(
            mediaR2Service.moveCatalogItemObject({
                websiteSlug: 'iffers-pictures',
                id: 10,
                destinationKey: 'events/baby-shower/new-name.jpg',
            })
        ).resolves.toMatchObject({
            destination_key:
                'clients/iffers-pictures/events/baby-shower/new-name.jpg',
        })
        expect(mockState.updateItem).toHaveBeenLastCalledWith({
            websiteSlug: 'iffers-pictures',
            id: 10,
            key: 'clients/iffers-pictures/events/baby-shower/new-name.jpg',
            filename: 'new-name.jpg',
            src: 'https://pub.example.test/clients/iffers-pictures/events/baby-shower/new-name.jpg',
        })
    })

    it('does not return adjacent R2 prefixes when listing a configured namespace root', async () => {
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: prefixedR2ConfigRecord, error: null },
        ]
        mockState.send.mockResolvedValueOnce({
            Contents: [
                {
                    Key: 'clients/iffers-pictures/events/baby-shower/image.jpg',
                    Size: 1234,
                },
                {
                    Key: 'clients/iffers-pictures-old/events/private.jpg',
                    Size: 9999,
                },
            ],
        })

        const result = await mediaR2Service.listObjects({
            websiteSlug: 'iffers-pictures',
        })

        expect(mockState.commands[0]).toEqual({
            name: 'ListObjectsV2Command',
            input: {
                Bucket: 'iffers-pictures',
                Prefix: 'clients/iffers-pictures/',
                MaxKeys: 1000,
            },
        })
        expect(result.objects).toEqual([
            expect.objectContaining({
                key: 'clients/iffers-pictures/events/baby-shower/image.jpg',
            }),
        ])
    })

    it('returns catalog destination collisions without overwriting objects', async () => {
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: r2ConfigRecord, error: null },
            { data: draftItem, error: null },
            { data: { id: 99 }, error: null },
        ]
        mockState.send
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(notFoundError)

        await expect(
            mediaR2Service.moveCatalogItemObject({
                websiteSlug: 'iffers-pictures',
                id: 10,
                destinationKey: 'events/baby-shower/collision.jpg',
            })
        ).rejects.toMatchObject({
            status: 409,
            code: 'media.destination_collision',
        })
        expect(
            mockState.commands.some(command => command.name === 'CopyObjectCommand')
        ).toBe(false)
        expect(
            mockState.commands.some(
                command => command.name === 'DeleteObjectCommand'
            )
        ).toBe(false)
        expect(mockState.updateItem).not.toHaveBeenCalled()
    })

    it('moves draft objects by copying, updating catalog metadata, and deleting source', async () => {
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: r2ConfigRecord, error: null },
            { data: draftItem, error: null },
            { data: null, error: null },
        ]
        mockState.send
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(notFoundError)
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
        mockState.updateItem.mockResolvedValue({
            id: 10,
            key: 'events/baby-shower/new-name.jpg',
            filename: 'new-name.jpg',
            src: 'https://pub.example.test/events/baby-shower/new-name.jpg',
            alt: 'Source image',
            service: 'Events',
            subCategory: 'Baby Shower',
            aspectRatio: 'portrait',
            status: 'draft',
            sortOrder: 0,
        })

        const result = await mediaR2Service.moveCatalogItemObject({
            websiteSlug: 'iffers-pictures',
            id: 10,
            destinationKey: 'events/baby-shower/new-name.jpg',
        })

        expect(
            mockState.commands.find(command => command.name === 'CopyObjectCommand')
        ).toEqual({
            name: 'CopyObjectCommand',
            input: {
                Bucket: 'iffers-pictures',
                Key: 'events/baby-shower/new-name.jpg',
                CopySource: 'iffers-pictures/events/baby-shower/source.jpg',
                IfNoneMatch: '*',
            },
        })
        expect(mockState.updateItem).toHaveBeenCalledWith({
            websiteSlug: 'iffers-pictures',
            id: 10,
            key: 'events/baby-shower/new-name.jpg',
            filename: 'new-name.jpg',
            src: 'https://pub.example.test/events/baby-shower/new-name.jpg',
        })
        expect(
            mockState.commands.find(
                command => command.name === 'DeleteObjectCommand'
            )
        ).toEqual({
            name: 'DeleteObjectCommand',
            input: {
                Bucket: 'iffers-pictures',
                Key: 'events/baby-shower/source.jpg',
            },
        })
        expect(result).toEqual(
            expect.objectContaining({
                source_key: 'events/baby-shower/source.jpg',
                destination_key: 'events/baby-shower/new-name.jpg',
                source_deleted: true,
            })
        )
    })

    it('blocks published object moves', async () => {
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: r2ConfigRecord, error: null },
            { data: { ...draftItem, status: 'published' }, error: null },
        ]

        await expect(
            mediaR2Service.moveCatalogItemObject({
                websiteSlug: 'iffers-pictures',
                id: 10,
                destinationKey: 'events/baby-shower/new-name.jpg',
            })
        ).rejects.toMatchObject({
            status: 409,
            code: 'media.published_location_locked',
        })
        expect(mockState.send).not.toHaveBeenCalled()
    })

    it('maps conditional copy failures to destination collisions without updating catalog or deleting source', async () => {
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: r2ConfigRecord, error: null },
            { data: draftItem, error: null },
            { data: null, error: null },
        ]
        mockState.send
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(notFoundError)
            .mockRejectedValueOnce(
                Object.assign(new Error('precondition failed'), {
                    name: 'PreconditionFailed',
                    $metadata: { httpStatusCode: 412 },
                })
            )

        await expect(
            mediaR2Service.moveCatalogItemObject({
                websiteSlug: 'iffers-pictures',
                id: 10,
                destinationKey: 'events/baby-shower/race.jpg',
            })
        ).rejects.toMatchObject({
            status: 409,
            code: 'media.destination_collision',
            details: expect.objectContaining({
                r2_exists: true,
            }),
        })
        expect(mockState.updateItem).not.toHaveBeenCalled()
        expect(
            mockState.commands.some(
                command => command.name === 'DeleteObjectCommand'
            )
        ).toBe(false)
    })

    it('cleans up the copied destination object when catalog update fails', async () => {
        const updateError = new Error('catalog update failed')
        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: r2ConfigRecord, error: null },
            { data: draftItem, error: null },
            { data: null, error: null },
        ]
        mockState.send
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(notFoundError)
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
        mockState.updateItem.mockRejectedValue(updateError)

        await expect(
            mediaR2Service.moveCatalogItemObject({
                websiteSlug: 'iffers-pictures',
                id: 10,
                destinationKey: 'events/baby-shower/rollback.jpg',
            })
        ).rejects.toBe(updateError)

        const deleteCommands = mockState.commands.filter(
            command => command.name === 'DeleteObjectCommand'
        )
        expect(deleteCommands).toEqual([
            {
                name: 'DeleteObjectCommand',
                input: {
                    Bucket: 'iffers-pictures',
                    Key: 'events/baby-shower/rollback.jpg',
                },
            },
        ])
    })

    it('returns a partial-success move result when source object deletion fails after catalog update', async () => {
        const deleteError = new Error('delete failed')
        const consoleErrorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined)

        mockState.queryResults = [
            { data: websiteRecord, error: null },
            { data: r2ConfigRecord, error: null },
            { data: draftItem, error: null },
            { data: null, error: null },
        ]
        mockState.send
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(notFoundError)
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(deleteError)
        mockState.updateItem.mockResolvedValue({
            id: 10,
            key: 'events/baby-shower/delete-failed.jpg',
            filename: 'delete-failed.jpg',
            src: 'https://pub.example.test/events/baby-shower/delete-failed.jpg',
            alt: 'Source image',
            service: 'Events',
            subCategory: 'Baby Shower',
            aspectRatio: 'portrait',
            status: 'draft',
            sortOrder: 0,
        })

        try {
            await expect(
                mediaR2Service.moveCatalogItemObject({
                    websiteSlug: 'iffers-pictures',
                    id: 10,
                    destinationKey: 'events/baby-shower/delete-failed.jpg',
                })
            ).resolves.toMatchObject({
                destination_key: 'events/baby-shower/delete-failed.jpg',
                source_deleted: false,
            })
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Failed to delete source R2 object after catalog move: events/baby-shower/source.jpg',
                expect.objectContaining({
                    code: 'media.upload_provider_error',
                    details: expect.objectContaining({
                        operation: 'delete_object',
                        key: 'events/baby-shower/source.jpg',
                    }),
                })
            )
        } finally {
            consoleErrorSpy.mockRestore()
        }
    })
})
