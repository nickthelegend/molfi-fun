import { CallData, hash } from "starknet";

/**
 * Where a key's molfi account lives.
 *
 * One function, imported by both the browser and the server, because these two must agree
 * exactly: the server funds an address and the browser deploys and trades from one, and if
 * the derivations ever drift the STRK lands somewhere the visitor cannot reach. Two copies of
 * this arithmetic is the shape that bug takes.
 *
 * `already` is for a key whose account is already on chain at an address of its own — the
 * development wallet, or anything imported later. Deriving one for those would point at an
 * empty address that merely happens to share a key.
 */
export function accountAddressFor(publicKey: string, already?: string | null): string {
  if (already) return already;
  return hash.calculateContractAddressFromHash(
    publicKey,
    OZ_ACCOUNT_CLASS,
    CallData.compile({ publicKey }),
    0,
  );
}

/**
 * OpenZeppelin's account, already declared on Sepolia.
 *
 * Chosen rather than invented: it is the class `sncast` deploys, so it is present on the
 * network without molfi declaring anything, and its constructor takes exactly the one public
 * key a Privy signer provides.
 */
export const OZ_ACCOUNT_CLASS =
  "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";
