import { domaniDb } from './domani-db'

// Bump this only when a PVS API release starts requiring a newer Domani schema.
export const MIN_DOMANI_SCHEMA_VERSION = '20260920191655'

type ContractResult = {
    data: unknown
    error: { message: string } | null
}

export async function assertDomaniSchemaContract(
    readVersion: () => Promise<ContractResult> = async () => {
        const { data, error } = await domaniDb
            .rpc('pvs_domani_schema_contract_version')
            .abortSignal(AbortSignal.timeout(10_000))
        return { data, error }
    }
): Promise<void> {
    let result: ContractResult
    try {
        result = await readVersion()
    } catch {
        throw new Error(
            'Cannot verify the Domani schema contract. Check the Domani database connection and apply the Domani migrations before deploying this PVS API.'
        )
    }

    if (result.error) {
        throw new Error(
            `Cannot verify the Domani schema contract: ${result.error.message}. Apply the Domani pvs_schema_contract migration before deploying this PVS API.`
        )
    }

    const version = result.data
    if (typeof version !== 'string' || !/^\d{14}$/.test(version)) {
        throw new Error(
            `Domani returned an invalid schema contract version: ${String(version)}.`
        )
    }
    if (version < MIN_DOMANI_SCHEMA_VERSION) {
        throw new Error(
            `Domani schema contract ${version} is older than required ${MIN_DOMANI_SCHEMA_VERSION}. Apply the pending Domani migrations before deploying this PVS API.`
        )
    }
}
