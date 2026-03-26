import { Router } from 'express'
import { body } from 'express-validator'

import { validateRequest } from './middleware'
import seo from '../controllers/seo'

const router = Router()

const VALID_GRADES = [
    'A+',
    'A',
    'A-',
    'B+',
    'B',
    'B-',
    'C+',
    'C',
    'C-',
    'D',
    'F',
]

const VALID_TRENDS = ['up', 'down', 'stable', 'new', 'lost']

const VALID_IMPACTS = ['positive', 'negative', 'neutral']

// POST /api/seo/audits - Submit or update an SEO audit
router.post(
    '/api/seo/audits',
    [
        body('website_id')
            .isUUID()
            .withMessage('website_id must be a valid UUID'),
        body('audit_date')
            .optional()
            .isISO8601()
            .withMessage('audit_date must be a valid ISO date'),
        body('score')
            .isInt({ min: 0, max: 100 })
            .withMessage('score must be an integer between 0 and 100'),
        body('grade')
            .isIn(VALID_GRADES)
            .withMessage(`grade must be one of: ${VALID_GRADES.join(', ')}`),
        body('auditor')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('auditor is required'),
        body('findings_count')
            .isInt({ min: 0 })
            .withMessage('findings_count must be a non-negative integer'),
        body('summary')
            .optional()
            .isString()
            .withMessage('summary must be a string'),
        body('next_audit_due')
            .optional()
            .isISO8601()
            .withMessage('next_audit_due must be a valid ISO date'),
        body('raw_data')
            .optional()
            .isObject()
            .withMessage('raw_data must be an object'),
        body('checklist')
            .optional()
            .isArray({ max: 50 })
            .withMessage('checklist must be an array (max 50 items)'),
        body('checklist.*.category')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('checklist category is required'),
        body('checklist.*.total')
            .isInt({ min: 0 })
            .withMessage('checklist total must be a non-negative integer'),
        body('checklist.*.completed')
            .isInt({ min: 0 })
            .withMessage('checklist completed must be a non-negative integer'),
        body('checklist.*.pct')
            .isFloat({ min: 0, max: 100 })
            .withMessage('checklist pct must be between 0 and 100'),
        body('changelog')
            .optional()
            .isArray({ max: 200 })
            .withMessage('changelog must be an array (max 200 items)'),
        body('changelog.*.date')
            .isISO8601()
            .withMessage('changelog date must be a valid ISO date'),
        body('changelog.*.description')
            .isString()
            .notEmpty()
            .withMessage('changelog description is required'),
        body('changelog.*.category')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('changelog category is required'),
        body('changelog.*.impact')
            .isIn(VALID_IMPACTS)
            .withMessage(
                `changelog impact must be one of: ${VALID_IMPACTS.join(', ')}`
            ),
        body('keywords')
            .optional()
            .isArray({ max: 500 })
            .withMessage('keywords must be an array (max 500 items)'),
        body('keywords.*.keyword')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('keyword text is required'),
        body('keywords.*.position')
            .optional({ nullable: true })
            .isInt({ min: 1 })
            .withMessage('keyword position must be a positive integer'),
        body('keywords.*.previous_position')
            .optional({ nullable: true })
            .isInt({ min: 1 })
            .withMessage(
                'keyword previous_position must be a positive integer'
            ),
        body('keywords.*.search_volume')
            .optional({ nullable: true })
            .isInt({ min: 0 })
            .withMessage(
                'keyword search_volume must be a non-negative integer'
            ),
        body('keywords.*.trend')
            .isIn(VALID_TRENDS)
            .withMessage(
                `keyword trend must be one of: ${VALID_TRENDS.join(', ')}`
            ),
        body('keywords.*.target_city')
            .optional()
            .isString()
            .withMessage('keyword target_city must be a string'),
        body('keywords.*.target_url')
            .optional()
            .isString()
            .withMessage('keyword target_url must be a string'),
        body('competitors')
            .optional()
            .isArray({ max: 100 })
            .withMessage('competitors must be an array (max 100 items)'),
        body('competitors.*.competitor_domain')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('competitor_domain is required'),
        body('competitors.*.da_score')
            .optional({ nullable: true })
            .isInt({ min: 0, max: 100 })
            .withMessage('da_score must be between 0 and 100'),
        body('competitors.*.keyword_overlap')
            .optional({ nullable: true })
            .isInt({ min: 0 })
            .withMessage(
                'keyword_overlap must be a non-negative integer'
            ),
        body('competitors.*.overlap_keywords')
            .optional()
            .isArray()
            .withMessage('overlap_keywords must be an array'),
        body('competitors.*.notes')
            .optional()
            .isString()
            .withMessage('competitor notes must be a string'),
    ],
    validateRequest,
    seo.submitAudit
)

export default router
