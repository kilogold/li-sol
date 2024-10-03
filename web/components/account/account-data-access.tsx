'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  createAmountToUiAmountInstruction,
  getInterestBearingMintConfigState,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
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
