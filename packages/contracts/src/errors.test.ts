import { describe, expect, it } from "vitest"
import { ORDER_EXECUTION_FROZEN_MESSAGE, parseSorobanError } from "./errors"

describe("parseSorobanError", () => {
  it("maps contract error tokens to user-facing messages", () => {
    expect(parseSorobanError({ message: "host invocation failed: ORDER_EXECUTION_FROZEN" })).toBe(
      ORDER_EXECUTION_FROZEN_MESSAGE,
    )
  })

  it("walks nested RPC error payloads", () => {
    expect(
      parseSorobanError({
        response: {
          data: '{"error":{"message":"tx_bad_seq"}}',
        },
      }),
    ).toBe("Transaction sequence is out of date. Refresh and try again.")
  })

  describe("RPC error code mapping with specificity", () => {
    describe("tx_bad_auth vs tx_bad_auth_extra", () => {
      it("maps tx_bad_auth to signature invalid message", () => {
        expect(parseSorobanError("tx_bad_auth")).toBe(
          "Transaction signature invalid. Try reconnecting your wallet.",
        )
      })

      it("maps tx_bad_auth_extra to unexpected signatures message (most specific wins)", () => {
        expect(parseSorobanError("tx_bad_auth_extra")).toBe(
          "Transaction contains unexpected signatures. Try reconnecting your wallet.",
        )
      })

      it("maps tx_bad_auth_extra in nested JSON payload", () => {
        const error = {
          response: {
            data: JSON.stringify({
              error: {
                code: -32600,
                message: "transaction submission failed",
                data: { extras: { result_xdr: "AAAAAAAAAmT//////////w==" }, reason: "tx_bad_auth_extra" },
              },
            }),
          },
        }
        expect(parseSorobanError(error)).toBe(
          "Transaction contains unexpected signatures. Try reconnecting your wallet.",
        )
      })

      it("maps tx_bad_auth_extra in Error with cause chain", () => {
        const rootCause = new Error("RPC Error: tx_bad_auth_extra detected")
        const intermediateError = new Error("Stellar RPC call failed", { cause: rootCause })
        const topLevelError = new Error("Transaction submission error", { cause: intermediateError })

        expect(parseSorobanError(topLevelError)).toBe(
          "Transaction contains unexpected signatures. Try reconnecting your wallet.",
        )
      })

      it("prioritizes tx_bad_auth_extra over tx_bad_auth when both are present", () => {
        // This tests that longer codes are checked first
        const error = "Error contains both tx_bad_auth and tx_bad_auth_extra codes"
        expect(parseSorobanError(error)).toBe(
          "Transaction contains unexpected signatures. Try reconnecting your wallet.",
        )
      })

      it("maps tx_bad_auth when only the shorter code is present", () => {
        const error = "Error: tx_bad_auth occurred"
        expect(parseSorobanError(error)).toBe(
          "Transaction signature invalid. Try reconnecting your wallet.",
        )
      })
    })

    describe("tx_insufficient_fee", () => {
      it("maps tx_insufficient_fee to fee too low message", () => {
        expect(parseSorobanError("tx_insufficient_fee")).toBe(
          "Transaction fee is too low. Try again with a higher fee.",
        )
      })

      it("maps tx_insufficient_fee in nested JSON string", () => {
        const jsonString = JSON.stringify({
          error: "tx_insufficient_fee",
          details: { fee_required: 10000, fee_provided: 5000 },
        })
        expect(parseSorobanError(jsonString)).toBe(
          "Transaction fee is too low. Try again with a higher fee.",
        )
      })

      it("maps tx_insufficient_fee in Error instance with nested JSON cause", () => {
        const jsonCause = JSON.stringify({ rpc_error: "tx_insufficient_fee", code: -32001 })
        const causeError = new Error(jsonCause)
        const mainError = new Error("Network request failed", { cause: causeError })

        expect(parseSorobanError(mainError)).toBe(
          "Transaction fee is too low. Try again with a higher fee.",
        )
      })

      it("maps tx_insufficient_fee in deeply nested JSON payload", () => {
        const nestedJson = {
          response: {
            data: JSON.stringify({
              errors: [
                {
                  message: JSON.stringify({
                    stellar: { error: "tx_insufficient_fee" },
                  }),
                },
              ],
            }),
          },
        }
        expect(parseSorobanError(nestedJson)).toBe(
          "Transaction fee is too low. Try again with a higher fee.",
        )
      })
    })

    describe("tx_insufficient_balance", () => {
      it("maps tx_insufficient_balance to balance too low message", () => {
        expect(parseSorobanError("tx_insufficient_balance")).toBe(
          "Wallet balance is too low to submit this transaction.",
        )
      })

      it("maps tx_insufficient_balance in Error with multiple causes", () => {
        const cause1 = new Error("Balance check failed")
        const cause2 = new Error("tx_insufficient_balance", { cause: cause1 })
        const topError = new Error("Submission failed", { cause: cause2 })

        expect(parseSorobanError(topError)).toBe(
          "Wallet balance is too low to submit this transaction.",
        )
      })

      it("maps tx_insufficient_balance in JSON within error message", () => {
        const error = {
          message: '{"status":"failed","reason":"tx_insufficient_balance","timestamp":1234567890}',
        }
        expect(parseSorobanError(error)).toBe(
          "Wallet balance is too low to submit this transaction.",
        )
      })

      it("maps tx_insufficient_balance with mixed casing", () => {
        // The implementation normalizes to lowercase, so this should still match
        const error = "Error: TX_INSUFFICIENT_BALANCE detected"
        expect(parseSorobanError(error)).toBe(
          "Wallet balance is too low to submit this transaction.",
        )
      })
    })

    describe("tx_too_early", () => {
      it("maps tx_too_early to submitted too early message", () => {
        expect(parseSorobanError("tx_too_early")).toBe(
          "Transaction submitted too early. Wait a moment and try again.",
        )
      })

      it("maps tx_too_early in nested Error chain with JSON", () => {
        const jsonData = JSON.stringify({ error_code: "tx_too_early", min_time: 1700000000 })
        const innerError = new Error(jsonData)
        const outerError = new Error("Time validation failed", { cause: innerError })

        expect(parseSorobanError(outerError)).toBe(
          "Transaction submitted too early. Wait a moment and try again.",
        )
      })

      it("maps tx_too_early in complex nested structure", () => {
        const error = {
          response: {
            status: 400,
            data: {
              error: JSON.stringify({
                type: "timebounds",
                message: "tx_too_early",
              }),
            },
          },
        }
        expect(parseSorobanError(error)).toBe(
          "Transaction submitted too early. Wait a moment and try again.",
        )
      })
    })

    describe("tx_too_late", () => {
      it("maps tx_too_late to transaction expired message", () => {
        expect(parseSorobanError("tx_too_late")).toBe("Transaction expired. Please try again.")
      })

      it("maps tx_too_late in Error with cause", () => {
        const causeError = new Error("Timebounds validation: tx_too_late")
        const mainError = new Error("Transaction rejected", { cause: causeError })

        expect(parseSorobanError(mainError)).toBe("Transaction expired. Please try again.")
      })

      it("maps tx_too_late in JSON array", () => {
        const jsonString = JSON.stringify({
          errors: ["tx_too_late", "sequence_invalid"],
        })
        expect(parseSorobanError(jsonString)).toBe("Transaction expired. Please try again.")
      })

      it("maps tx_too_late in deeply nested cause chain", () => {
        const cause3 = new Error("RPC: tx_too_late")
        const cause2 = new Error("Network error", { cause: cause3 })
        const cause1 = new Error("Request failed", { cause: cause2 })
        const topError = new Error("API call failed", { cause: cause1 })

        expect(parseSorobanError(topError)).toBe("Transaction expired. Please try again.")
      })
    })

    describe("deterministic mapping with substring overlaps", () => {
      it("handles errors containing multiple RPC codes by prioritizing longest match", () => {
        // When multiple codes match, the longest one should win due to sortedErrorMessages
        const errorWithMultiple = "Error: tx_bad_auth_extra and tx_bad_auth both failed"
        expect(parseSorobanError(errorWithMultiple)).toBe(
          "Transaction contains unexpected signatures. Try reconnecting your wallet.",
        )
      })

      it("correctly maps when shorter code appears first in text", () => {
        const error = "tx_bad_auth occurred, but also tx_bad_auth_extra"
        // Should still map to the longer, more specific code
        expect(parseSorobanError(error)).toBe(
          "Transaction contains unexpected signatures. Try reconnecting your wallet.",
        )
      })

      it("handles edge case where substring appears as part of longer code only", () => {
        const error = "Error: tx_bad_auth_extra_info"
        // Should match tx_bad_auth_extra as substring
        expect(parseSorobanError(error)).toBe(
          "Transaction contains unexpected signatures. Try reconnecting your wallet.",
        )
      })

      it("maintains deterministic ordering across multiple runs", () => {
        // Run the same error multiple times to ensure consistency
        const error = "tx_insufficient_balance tx_insufficient_fee tx_bad_auth_extra"
        const results = Array.from({ length: 5 }, () => parseSorobanError(error))

        // All results should be identical
        expect(new Set(results).size).toBe(1)
        // Should map to longest code (tx_bad_auth_extra or tx_insufficient_balance/fee - all same length)
        // Due to sorted order, one specific message should consistently win
        expect(results[0]).toMatch(/Transaction|Wallet balance/)
      })
    })

    describe("error instances with complex structures", () => {
      it("handles Error with JSON in message and JSON in cause", () => {
        const causeJson = JSON.stringify({ error: "tx_bad_auth_extra" })
        const cause = new Error(causeJson)
        const messageJson = JSON.stringify({ status: "failed" })
        const error = new Error(messageJson, { cause })

        expect(parseSorobanError(error)).toBe(
          "Transaction contains unexpected signatures. Try reconnecting your wallet.",
        )
      })

      it("handles circular reference protection with RPC errors", () => {
        const obj: any = { message: "tx_insufficient_fee" }
        obj.self = obj // Create circular reference

        // Should not throw and should still find the error
        expect(parseSorobanError(obj)).toBe(
          "Transaction fee is too low. Try again with a higher fee.",
        )
      })

      it("handles array of errors with RPC codes", () => {
        const errors = [
          new Error("First error"),
          new Error("tx_too_early"),
          new Error("Third error"),
        ]
        expect(parseSorobanError(errors)).toBe(
          "Transaction submitted too early. Wait a moment and try again.",
        )
      })

      it("handles object with multiple error properties", () => {
        const error = {
          primary: "Some error",
          secondary: { message: "tx_too_late" },
          details: "Additional info",
        }
        expect(parseSorobanError(error)).toBe("Transaction expired. Please try again.")
      })
    })

    describe("edge cases and normalization", () => {
      it("handles RPC error code with surrounding whitespace", () => {
        const error = "  tx_insufficient_balance  "
        expect(parseSorobanError(error)).toBe(
          "Wallet balance is too low to submit this transaction.",
        )
      })

      it("handles RPC error code in JSON with escaped characters", () => {
        const jsonString = '{"error":"tx_bad_auth\\nAdditional context"}'
        expect(parseSorobanError(jsonString)).toBe(
          "Transaction signature invalid. Try reconnecting your wallet.",
        )
      })

      it("handles null and undefined gracefully", () => {
        expect(parseSorobanError(null)).toBe("Transaction failed. Please try again.")
        expect(parseSorobanError(undefined)).toBe("Transaction failed. Please try again.")
      })

      it("handles empty string", () => {
        expect(parseSorobanError("")).toBe("Transaction failed. Please try again.")
      })

      it("handles non-error primitive values", () => {
        expect(parseSorobanError(12345)).toBe("Transaction failed. Please try again.")
        expect(parseSorobanError(true)).toBe("Transaction failed. Please try again.")
      })
    })
  })

  describe("unknown and malformed errors return safe fallback", () => {
    const FALLBACK_MESSAGE = "Transaction failed. Please try again."

    describe("primitive types without error codes", () => {
      it("returns fallback for null", () => {
        expect(parseSorobanError(null)).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for undefined", () => {
        expect(parseSorobanError(undefined)).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for empty string", () => {
        expect(parseSorobanError("")).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for whitespace-only string", () => {
        expect(parseSorobanError("   ")).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError("\n\t  ")).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for number", () => {
        expect(parseSorobanError(0)).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError(42)).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError(-1)).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError(3.14)).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError(NaN)).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError(Infinity)).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for boolean", () => {
        expect(parseSorobanError(true)).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError(false)).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for BigInt", () => {
        expect(parseSorobanError(BigInt(123))).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for Symbol", () => {
        expect(parseSorobanError(Symbol("error"))).toBe(FALLBACK_MESSAGE)
      })
    })

    describe("empty and trivial collections", () => {
      it("returns fallback for empty array", () => {
        expect(parseSorobanError([])).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for array of empty values", () => {
        expect(parseSorobanError([null, undefined, ""])).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError([0, false, []])).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for empty object", () => {
        expect(parseSorobanError({})).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for object with null/undefined values", () => {
        expect(parseSorobanError({ a: null, b: undefined })).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for nested empty structures", () => {
        expect(parseSorobanError({ data: { errors: [] } })).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError({ response: { data: {} } })).toBe(FALLBACK_MESSAGE)
      })
    })

    describe("malformed JSON strings", () => {
      it("returns fallback for invalid JSON (unclosed brace)", () => {
        expect(parseSorobanError('{"error": "something"')).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for invalid JSON (unclosed bracket)", () => {
        expect(parseSorobanError('["error", "data"')).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for invalid JSON (trailing comma)", () => {
        expect(parseSorobanError('{"error": "msg",}')).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for invalid JSON (single quotes)", () => {
        expect(parseSorobanError("{'error': 'message'}")).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for invalid JSON (unquoted keys)", () => {
        expect(parseSorobanError('{error: "message"}')).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for JSON-like string that doesn't parse", () => {
        expect(parseSorobanError('{{invalid}}')).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError('[[]')).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError('{]')).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for nested malformed JSON", () => {
        const error = {
          response: {
            data: '{"error": {"message": "unclosed',
          },
        }
        expect(parseSorobanError(error)).toBe(FALLBACK_MESSAGE)
      })
    })

    describe("circular references", () => {
      it("returns fallback for circular object without error codes", () => {
        const obj: any = { message: "unknown error" }
        obj.self = obj
        expect(parseSorobanError(obj)).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for circular array", () => {
        const arr: any[] = [1, 2, 3]
        arr.push(arr)
        expect(parseSorobanError(arr)).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for mutually circular objects", () => {
        const obj1: any = { name: "first" }
        const obj2: any = { name: "second" }
        obj1.ref = obj2
        obj2.ref = obj1
        expect(parseSorobanError(obj1)).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for deeply circular structure", () => {
        const root: any = { level: 0 }
        let current = root
        for (let i = 1; i < 5; i++) {
          current.next = { level: i }
          current = current.next
        }
        current.next = root // Create cycle
        expect(parseSorobanError(root)).toBe(FALLBACK_MESSAGE)
      })
    })

    describe("unknown contract-like text", () => {
      it("returns fallback for generic error message", () => {
        expect(parseSorobanError("Something went wrong")).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for contract-like error without known code", () => {
        expect(parseSorobanError("Error: UNKNOWN_CONTRACT_ERROR")).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for Soroban-like error with unknown code", () => {
        expect(parseSorobanError("host invocation failed: UNKNOWN_ERROR_CODE")).toBe(
          FALLBACK_MESSAGE,
        )
      })

      it("returns fallback for RPC-like error with unknown code", () => {
        expect(parseSorobanError("tx_unknown_error_type")).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for error with partial matches", () => {
        expect(parseSorobanError("tx_something_else")).toBe(FALLBACK_MESSAGE)
        expect(parseSorobanError("INSUFFICIENT_SOMETHING_ELSE")).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for Error instance with unknown message", () => {
        const error = new Error("Unknown blockchain error occurred")
        expect(parseSorobanError(error)).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for nested unknown errors", () => {
        const error = {
          response: {
            data: JSON.stringify({
              error: { code: "UNKNOWN_ERROR", message: "Contract execution failed" },
            }),
          },
        }
        expect(parseSorobanError(error)).toBe(FALLBACK_MESSAGE)
      })
    })

    describe("edge cases that should not throw", () => {
      it("handles function without throwing", () => {
        expect(parseSorobanError(() => "error")).toBe(FALLBACK_MESSAGE)
      })

      it("handles class instance without throwing", () => {
        class CustomError {
          message = "unknown"
        }
        expect(parseSorobanError(new CustomError())).toBe(FALLBACK_MESSAGE)
      })

      it("handles Date object without throwing", () => {
        expect(parseSorobanError(new Date())).toBe(FALLBACK_MESSAGE)
      })

      it("handles RegExp without throwing", () => {
        expect(parseSorobanError(/error/)).toBe(FALLBACK_MESSAGE)
      })

      it("handles Map without throwing", () => {
        const map = new Map([["error", "unknown"]])
        expect(parseSorobanError(map)).toBe(FALLBACK_MESSAGE)
      })

      it("handles Set without throwing", () => {
        const set = new Set(["unknown", "error"])
        expect(parseSorobanError(set)).toBe(FALLBACK_MESSAGE)
      })

      it("handles deeply nested null/undefined chain", () => {
        expect(parseSorobanError({ a: { b: { c: { d: null } } } })).toBe(FALLBACK_MESSAGE)
      })

      it("handles Error with null cause", () => {
        const error = new Error("message", { cause: null })
        expect(parseSorobanError(error)).toBe(FALLBACK_MESSAGE)
      })

      it("handles Error with undefined cause", () => {
        const error = new Error("message", { cause: undefined })
        expect(parseSorobanError(error)).toBe(FALLBACK_MESSAGE)
      })

      it("handles Error chain with no recognizable codes", () => {
        const cause3 = new Error("Third level error")
        const cause2 = new Error("Second level error", { cause: cause3 })
        const cause1 = new Error("First level error", { cause: cause2 })
        expect(parseSorobanError(cause1)).toBe(FALLBACK_MESSAGE)
      })

      it("handles very long string without known codes", () => {
        const longString = "x".repeat(10000)
        expect(parseSorobanError(longString)).toBe(FALLBACK_MESSAGE)
      })

      it("handles special characters and unicode", () => {
        expect(parseSorobanError("エラー 错误 ошибка 🚫")).toBe(FALLBACK_MESSAGE)
      })

      it("handles strings with control characters", () => {
        expect(parseSorobanError("error\x00\x01\x02")).toBe(FALLBACK_MESSAGE)
      })
    })

    describe("arrays with unknown content", () => {
      it("returns fallback for array of unknown strings", () => {
        expect(parseSorobanError(["error1", "error2", "error3"])).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for array of Error instances without known codes", () => {
        const errors = [new Error("Unknown 1"), new Error("Unknown 2"), new Error("Unknown 3")]
        expect(parseSorobanError(errors)).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for mixed array of primitives", () => {
        expect(parseSorobanError([1, "error", true, null, { message: "unknown" }])).toBe(
          FALLBACK_MESSAGE,
        )
      })

      it("returns fallback for nested arrays without known codes", () => {
        expect(parseSorobanError([[[["error"]]]])).toBe(FALLBACK_MESSAGE)
      })
    })

    describe("objects with unknown content", () => {
      it("returns fallback for object with random properties", () => {
        expect(parseSorobanError({ foo: "bar", baz: 123 })).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for object mimicking error structure but with unknown codes", () => {
        expect(
          parseSorobanError({
            error: { code: "UNKNOWN", message: "Something failed" },
          }),
        ).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for response-like object without known errors", () => {
        expect(
          parseSorobanError({
            response: { status: 500, data: "Internal server error" },
          }),
        ).toBe(FALLBACK_MESSAGE)
      })

      it("returns fallback for deeply nested object without known codes", () => {
        expect(
          parseSorobanError({
            level1: { level2: { level3: { level4: { error: "unknown" } } } },
          }),
        ).toBe(FALLBACK_MESSAGE)
      })
    })
  })
})
