'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  createAmountToUiAmountInstruction,
  getInterestBearingMintConfigState,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenInstruction,
} from '@solana/spl-token';
import {
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

    // If the token account's mint lacks interest bearing extension configuration, it likely doesn't have the extension.
    // In this case, we return the basic uiAmount.
    if ('spl-token-2022' !== account.data.program) {
      results[pubkey.toString()] = account.data.parsed.info.tokenAmount.uiAmount;
      continue;
    }

    const mintInfo = await getMint(connection, new PublicKey(account.data.parsed.info.mint), undefined, TOKEN_2022_PROGRAM_ID);
    if (getInterestBearingMintConfigState(mintInfo) == null) {
      results[pubkey.toString()] = account.data.parsed.info.tokenAmount.uiAmount;
      continue;
    }

    // Mark that at least one mint account has the interest bearing extension
    hasInterestBearing = true;

    // Otherwise, we need to fetch the uiAmount from the mint's interest bearing extension.
    try {
      const jsonBody = {
        mint: account.data.parsed.info.mint,
        amount: account.data.parsed.info.tokenAmount.amount,
        endpoint: connection.rpcEndpoint,
      };

      const response = await fetch('/api/signTransaction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jsonBody),
      });

      if (!response.ok) {
        throw new Error(response.statusText);
      }

      const signedTransactionBase64 = await response.text();
      const signedTransaction = Transaction.from(
        Buffer.from(signedTransactionBase64, 'base64')
      );

      // Simulate the transaction
      const { returnData, err } = (
        await connection.simulateTransaction(signedTransaction)
      ).value;

      if (err) {
        throw new Error(err.toString());
      }

      if (returnData?.data) {
        results[pubkey.toString()] = Buffer.from(
          returnData.data[0],
          returnData.data[1]
        ).toString('utf-8');
      } else {
        results[pubkey.toString()] = null;
      }
    } catch (error) {
      console.error(`Error processing account ${pubkey.toString()}:`, error);
      results[pubkey.toString()] = null;
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

export function hasInstructionDiscriminator(transaction: ParsedTransactionWithMeta, discriminator: number): boolean {
  if (!transaction || !transaction.transaction || !transaction.transaction.message) {
    console.log('bad transaction', transaction);
    return false;
  }

  const instructions = transaction.transaction.message.instructions;
  return instructions.some((instruction: ParsedInstruction | PartiallyDecodedInstruction) => {
    // Check if the instruction is partially decoded and has a data field
    if ('data' in instruction) {
      const decodedData = Buffer.from(instruction.data, 'base64');
      return decodedData[0] === discriminator;
    }

    console.log('No discriminator', instruction);
    return false;
  });
}

// Filters transactions from Token22 program for interest-bearing instructionsaccording to the mint address.
export function useFilteredTransactions({ rateAuthorityAddress }: { rateAuthorityAddress: PublicKey }) {
    const { connection } = useConnection();

    return useQuery({
        queryKey: ['filtered-transactions', { endpoint: connection.rpcEndpoint, rateAuthorityAddress }],
        queryFn: async () => {
            // Get all the signatures produced by the rate authority.
            const allSignatures = await connection.getSignaturesForAddress(rateAuthorityAddress);

            const filteredSignatures = await Promise.all(

                // Each signature potentially maps to multiple instructions.
                allSignatures.map(async (info) => {
                    console.log('info', info);

                    // Obtain a parseable transaction from the signature.
                    const transaction = await connection.getTransaction(info.signature, {
                        maxSupportedTransactionVersion: 0,
                    });

                    // Transaction must not be null, since we obtain signatures from the API.
                    if (!transaction) {
                        throw new Error(`Transaction not found for signature: ${info.signature}`);
                    }

                    // Filter the instructions for the interest-bearing program.
                    const filteredInstructions = transaction.transaction.message.compiledInstructions.filter((instruction, index) => {
                        // Check if it's a Token22 transaction
                        const programId = transaction.transaction.message.getAccountKeys().get(instruction.programIdIndex);
                        console.log('filter:programId', programId?.toBase58());
                        if (!programId?.equals(TOKEN_2022_PROGRAM_ID)) {
                            return false;
                        }

                        // Check the instruction discriminator
                        if (instruction.data[0] !== TokenInstruction.InterestBearingMintExtension) {
                            return false;
                        }

                        // If we've made it this far, the instruction passes all checks
                        return true;
                    });

                    // If not instructions matched, map to null as filter for the encapsulating transaction.
                    if (filteredInstructions.length === 0) {
                        return null;
                    }

                    // Parse the matching instructions to interest rate data.
                    const parsedTransaction = await connection.getParsedTransaction(info.signature, {
                        commitment: 'confirmed',
                        maxSupportedTransactionVersion: 0,
                    });

                    // Parsed transaction must never be null.
                    if (!parsedTransaction) {
                        throw new Error(`Parsed transaction not found for signature: ${info.signature}`);
                    }

                    console.log('matching transaction', parsedTransaction);

                    // Map each instruction to its parsed form.

                    

                    return {
                        ...info,
                        ibt_instructions: filteredInstructions,
                    };
                }) // signatureInfo.map
            ); // promise.all

            // Filter out disqualifying transactions via null filter.
            return filteredSignatures.filter(Boolean);
        },
    });
}
