import { xdr } from "@stellar/stellar-sdk"

export function i128ToScVal(value: bigint): xdr.ScVal {
  // Keep generated bindings compile-safe until contract-specific ScVal codecs are added.
  return xdr.ScVal.scvString(value.toString())
}
