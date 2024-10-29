'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  createAmountToUiAmountInstruction,
  ExtensionType,
  getExtensionTypes,
  getInterestBearingMintConfigState,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenInstruction,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  TokenInvalidAccountSizeError,
  createTransferInstruction,
} from '@solana/spl-token';
import {
  ConfirmedSignatureInfo,
  AccountInfo,
  Connection,
  LAMPORTS_PER_SOL,
  ParsedAccountData,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  TransactionSignature,
  VersionedTransaction,
  ParsedInstruction,
  PartiallyDecodedInstruction,
  ParsedTransactionWithMeta,
  TransactionResponse,
} from '@solana/web3.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTransactionToast } from '../ui/ui-layout';
import { useEffect, useState } from 'react';
import { useQueries, UseQueryResult } from '@tanstack/react-query';

export function useGetBalance({ address }: { address: PublicKey }) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ['get-balance', { endpoint: connection.rpcEndpoint, address }],
    queryFn: () => connection.getBalance(address),
  });
}

export function useGetSignatures({ address }: { address: PublicKey }) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ['get-signatures', { endpoint: connection.rpcEndpoint, address }],
    queryFn: () => connection.getConfirmedSignaturesForAddress2(address),
  });
}

export function useGetTokenAccounts({ address }: { address: PublicKey }) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: [
      'get-token-accounts',
      { endpoint: connection.rpcEndpoint, address },
    ],
    queryFn: async () => {
      const [tokenAccounts, token2022Accounts] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(address, {
          programId: TOKEN_PROGRAM_ID,
        }),
        connection.getParsedTokenAccountsByOwner(address, {
          programId: TOKEN_2022_PROGRAM_ID,
        }),
      ]);
      return [...tokenAccounts.value, ...token2022Accounts.value];
    },
  });
}

export async function getTokenAccountsUiAmounts({
  items,
  connection,
}: {
  items: { pubkey: PublicKey; account: AccountInfo<ParsedAccountData> }[];
  connection: Connection;
}): Promise<{ results: { [key: string]: string | null }; hasInterestBearing: boolean }> {
  const results: { [key: string]: string | null } = {};
  let hasInterestBearing = false;

  for (const { account, pubkey } of items) {
    const mintAddress = new PublicKey(account.data.parsed.info.mint);

    // Check if the token account's mint has the interest-bearing extension
    const accruedValue = await getAccruedValue(connection, mintAddress, pubkey);
    if (accruedValue !== null) {
      results[pubkey.toString()] = accruedValue;
      hasInterestBearing = true;
    } else {
      results[pubkey.toString()] = account.data.parsed.info.tokenAmount.uiAmount;
    }
  }

  return { results, hasInterestBearing };
}

export function useTransferSol({ address }: { address: PublicKey }) {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation({
    mutationKey: [
      'transfer-sol',
      { endpoint: connection.rpcEndpoint, address },
    ],
    mutationFn: async (input: { destination: PublicKey; amount: number }) => {
      let signature: TransactionSignature = '';
      try {
        const { transaction, latestBlockhash } = await createTransaction({
          publicKey: address,
          destination: input.destination,
          amount: input.amount,
          connection,
        });

        // Send transaction and await for signature
        signature = await wallet.sendTransaction(transaction, connection);

        // Send transaction and await for signature
        await connection.confirmTransaction(
          { signature, ...latestBlockhash },
          'confirmed'
        );

        console.log(signature);
        return signature;
      } catch (error: unknown) {
        console.log('error', `Transaction failed! ${error}`, signature);

        return;
      }
    },
    onSuccess: (signature) => {
      if (signature) {
        transactionToast(signature);
      }
      return Promise.all([
        client.invalidateQueries({
          queryKey: [
            'get-balance',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
        client.invalidateQueries({
          queryKey: [
            'get-signatures',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(`Transaction failed! ${error}`);
    },
  });
}

export function useRequestAirdrop({ address }: { address: PublicKey }) {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const client = useQueryClient();

  return useMutation({
    mutationKey: ['airdrop', { endpoint: connection.rpcEndpoint, address }],
    mutationFn: async (amount: number = 1) => {
      const [latestBlockhash, signature] = await Promise.all([
        connection.getLatestBlockhash(),
        connection.requestAirdrop(address, amount * LAMPORTS_PER_SOL),
      ]);

      await connection.confirmTransaction(
        { signature, ...latestBlockhash },
        'confirmed'
      );
      return signature;
    },
    onSuccess: (signature) => {
      transactionToast(signature);
      return Promise.all([
        client.invalidateQueries({
          queryKey: [
            'get-balance',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
        client.invalidateQueries({
          queryKey: [
            'get-signatures',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
      ]);
    },
  });
}

async function createTransaction({
  publicKey,
  destination,
  amount,
  connection,
}: {
  publicKey: PublicKey;
  destination: PublicKey;
  amount: number;
  connection: Connection;
}): Promise<{
  transaction: VersionedTransaction;
  latestBlockhash: { blockhash: string; lastValidBlockHeight: number };
}> {
  // Get the latest blockhash to use in our transaction
  const latestBlockhash = await connection.getLatestBlockhash();

  // Create instructions to send, in this case a simple transfer
  const instructions = [
    SystemProgram.transfer({
      fromPubkey: publicKey,
      toPubkey: destination,
      lamports: amount * LAMPORTS_PER_SOL,
    }),
  ];

  // Create a new TransactionMessage with version and compile it to legacy
  const messageLegacy = new TransactionMessage({
    payerKey: publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions,
  }).compileToLegacyMessage();

  // Create a new VersionedTransaction which supports legacy and v0
  const transaction = new VersionedTransaction(messageLegacy);

  return {
    transaction,
    latestBlockhash,
  };
}

export function useGetTransactionDetails({ signature }: { signature: string }) {
  const { connection } = useConnection();

  console.log('signature', signature);

  return useQuery({
    queryKey: ['get-transaction-details', { signature }],
    queryFn: async () => {
      if (!signature) {
        throw new Error('Signature is undefined');
      }
      const transaction = await connection.getParsedTransaction(signature);
      if (!transaction) {
        throw new Error('Transaction not found');
      }
      return transaction;
    },
  });
}


export interface InterestBearingConfirmedSignatureInfo extends ConfirmedSignatureInfo {
    resultantInterestRate: number;
}

// Filters transactions from Token22 program for interest-bearing extension (ibe) instructions according to the mint address.
export function useFilteredSuccessfulTransactions({ mintAddress }: { mintAddress: PublicKey }) {
    const { connection } = useConnection();

    return useQuery({
        queryKey: ['filtered-successful-transactions', { endpoint: connection.rpcEndpoint, mintAddress }],
        queryFn: async () => {
            // Query for all transactions produced by the mint account.
            const allSignatures = await connection.getSignaturesForAddress(mintAddress);

            // Only consider successful transactions.
            const successfulSignatures = allSignatures.filter(signature => signature.err === null);
            
            // Qualify(by first mapping, then filtering) signatures for transactions containing Token22, ibe instructions.
            const ibeSignatures = await Promise.all(
                successfulSignatures.map(async (signature) => {
                    const parsedTransaction = await connection.getParsedTransaction(signature.signature);

                    // Track the resultant interest rate for each transaction.
                    let resultantInterestRate = 0;

                    // Parsed transaction must not be null, since we obtained the signature from the API.
                    if (!parsedTransaction) 
                        throw new Error('Transaction not found');

                    // Chronologically combine main & inner instructions to account for CPI instructions.
                    const flattenedInstructions = parsedTransaction.transaction.message.instructions.flatMap((instruction, index) => {
                      const innerInstructions = parsedTransaction.meta?.innerInstructions?.[index]?.instructions || [];
                      return [instruction, ...innerInstructions];
                    });

                    // Of the Token22 instructions, only those pertaining to the interest-bearing extension are relevant.
                    // Relevance is determined by the discriminator of the instruction or its parsed type.
                    const isRelevant = flattenedInstructions.some(
                        (instruction) => {
                            const isPartiallyDecodedInstruction = 'data' in instruction;
                            if (isPartiallyDecodedInstruction) {
                                const discriminator = Number(instruction.data[0]);
                                if (discriminator === TokenInstruction.InterestBearingMintExtension)
                                    throw new Error('Unsupported InterestBearingMintExtension instruction.');

                                return false; // Irrelevant instruction.
                            }
                            else {
                                // Note: Instructions are chronologically ordered, so overwrite the resultant interest rate.
                                if (instruction.parsed.type === 'initializeInterestBearingConfig') {
                                    resultantInterestRate = instruction.parsed.info.rate;
                                    return true; // Relevant instruction.
                                } else if (instruction.parsed.type === 'updateInterestBearingConfigRate') {
                                    resultantInterestRate = instruction.parsed.info.newRate;
                                    return true; // Relevant instruction.
                                }
                                return false; // Irrelevant instruction.
                            }
                        }
                    );

                    // If the transaction does not contain any relevant instructions, it is disqualified.
                    if (!isRelevant) {
                        return null;
                    }

                    // Extend the signature collection with the resultant interest rate.
                    return {
                        ...signature,
                        resultantInterestRate
                    };
                })
            ).then(results => results.filter(Boolean)); // Filter out disqualified transactions.

            return ibeSignatures;
        },
    });
}

export async function isInterestBearingAccount(connection: Connection, address: PublicKey): Promise<boolean> {
  try {
    // Fetch the mint information for the given address
    const mint = await getMint(connection, address, 'confirmed', TOKEN_2022_PROGRAM_ID);

    // Get the extension types for the mint account
    const extensionTypes = getExtensionTypes(mint.tlvData);

    // Check if the mint account has the interest-bearing extension
    return extensionTypes.includes(ExtensionType.InterestBearingConfig);
  } catch (error) {
    if (
      error instanceof TokenAccountNotFoundError ||
      error instanceof TokenInvalidAccountOwnerError ||
      error instanceof TokenInvalidAccountSizeError
    ) {
      // INTENTIONAL:Address does not point to a valid mint account.
    } else {
      console.error('Error checking interest-bearing status:', error);
    }
    return false;
  }
}

export function useTransferToken({
  address,
  mintAddress,
}: {
  address: PublicKey;
  mintAddress: PublicKey;
}) {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation({
    mutationKey: [
      'transfer-token',
      { endpoint: connection.rpcEndpoint, address, mintAddress },
    ],
    mutationFn: async (input: { destination: PublicKey; amount: number }) => {
      let signature: TransactionSignature = '';
      try {
        const { transaction, latestBlockhash } = await createTokenTransaction({
          publicKey: address,
          destination: input.destination,
          amount: input.amount,
          mintAddress,
          connection,
        });

        // Send transaction and await for signature
        signature = await wallet.sendTransaction(transaction, connection);

        // Confirm transaction
        await connection.confirmTransaction(
          { signature, ...latestBlockhash },
          'confirmed'
        );

        console.log(signature);
        return signature;
      } catch (error: unknown) {
        console.log('error', `Transaction failed! ${error}`, signature);
        return;
      }
    },
    onSuccess: (signature) => {
      if (signature) {
        transactionToast(signature);
      }
      return Promise.all([
        client.invalidateQueries({
          queryKey: [
            'get-token-accounts',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
        client.invalidateQueries({
          queryKey: [
            'get-signatures',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(`Transaction failed! ${error}`);
    },
  });
}

async function createTokenTransaction({
  publicKey,
  destination,
  amount,
  mintAddress,
  connection,
}: {
  publicKey: PublicKey;
  destination: PublicKey;
  amount: number;
  mintAddress: PublicKey;
  connection: Connection;
}): Promise<{
  transaction: VersionedTransaction;
  latestBlockhash: { blockhash: string; lastValidBlockHeight: number };
}> {
  // Get the latest blockhash to use in our transaction
  const latestBlockhash = await connection.getLatestBlockhash();

  // Create instructions to send tokens
  const instructions = [
    createTransferInstruction(
      publicKey,
      destination,
      publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID
    ),
  ];

  // Create a new TransactionMessage with version and compile it to legacy
  const messageLegacy = new TransactionMessage({
    payerKey: publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions,
  }).compileToLegacyMessage();

  // Create a new VersionedTransaction which supports legacy and v0
  const transaction = new VersionedTransaction(messageLegacy);

  return {
    transaction,
    latestBlockhash,
  };
}

export async function fetchBalanceToValue({
  connection,
  mintAddress,
  tokenAmount,
}: {
  connection: Connection;
  mintAddress: PublicKey;
  tokenAmount: string;
}): Promise<string | null> {
  try {
    const jsonBody = {
      mint: mintAddress.toString(),
      amount: tokenAmount,
      endpoint: connection.rpcEndpoint,
    };

    const response = await fetch('/api/amountToUiAmount', { // Updated route name
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jsonBody),
    });

    if (!response.ok) {
      throw new Error(response.statusText);
    }

    const accruedValue = await response.text();
    return accruedValue;
  } catch (error) {
    console.error('Error fetching accrued value from server:', error);
    return null;
  }
}

export async function getAccruedValue(
  connection: Connection,
  mintAddress: PublicKey,
  tokenAccountAddress: PublicKey
): Promise<string | null> {
  try {
    // Check if the mint has the interest-bearing extension
    if ((await isInterestBearingAccount(connection, mintAddress)) === false) {
      return null;
    }

    // Fetch the token account balance
    const tokenAccountInfo = await connection.getParsedAccountInfo(tokenAccountAddress);
    if (!tokenAccountInfo.value) {
      throw new Error('Token account not found');
    }

    const tokenAmount = (tokenAccountInfo.value.data as ParsedAccountData).parsed.info.tokenAmount.amount;

    // Use the helper function to fetch the accrued value
    return await fetchBalanceToValue({
      connection,
      mintAddress,
      tokenAmount,
    });
  } catch (error) {
    console.error('Error calculating accrued value:', error);
    return null;
  }
}

export async function fetchValueToBalance({
  connection,
  mintAddress,
  uiAmount,
}: {
  connection: Connection;
  mintAddress: PublicKey;
  uiAmount: string;
}): Promise<string | null> {
  try {
    const jsonBody = {
      mint: mintAddress.toString(),
      amount: uiAmount,
      endpoint: connection.rpcEndpoint,
    };

    const response = await fetch('/api/uiAmountToAmount', { // Use the uiAmountToAmount route
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jsonBody),
    });

    if (!response.ok) {
      throw new Error(response.statusText);
    }

    const balanceValue = await response.text();
    console.log('balanceValue', balanceValue);
    return balanceValue;
  } catch (error) {
    console.error('Error fetching balance value from server:', error);
    return null;
  }
}
