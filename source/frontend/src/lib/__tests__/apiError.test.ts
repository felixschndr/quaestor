import { describe, expect, it } from 'vitest'

import { ApiError } from '../api'
import { readApiErrorMessage } from '../apiError'

// The translator stub echoes the key so assertions can tell which branch fired.
const t = (key: string) => key

describe('readApiErrorMessage', () => {
  it('surfaces the first 422 validation message from the detail array', () => {
    const err = new ApiError(422, { detail: [{ msg: 'Field is required' }] }, '')
    expect(readApiErrorMessage(err, t)).toBe('Field is required')
  })

  it('surfaces a 422 detail that is a plain string', () => {
    const err = new ApiError(422, { detail: 'Something specific went wrong' }, '')
    expect(readApiErrorMessage(err, t)).toBe('Something specific went wrong')
  })

  it('maps 429 to the rate-limit message', () => {
    const err = new ApiError(429, null, '')
    expect(readApiErrorMessage(err, t)).toBe('login.rateLimited')
  })

  it('falls back to the generic message for other API errors', () => {
    const err = new ApiError(500, null, '')
    expect(readApiErrorMessage(err, t)).toBe('login.genericError')
  })

  it('falls back to the generic message for non-ApiError values', () => {
    expect(readApiErrorMessage(new Error('boom'), t)).toBe('login.genericError')
    expect(readApiErrorMessage('boom', t)).toBe('login.genericError')
  })

  it('falls back to the generic message when a 422 carries no usable detail', () => {
    const err = new ApiError(422, { detail: [] }, '')
    expect(readApiErrorMessage(err, t)).toBe('login.genericError')
  })
})
