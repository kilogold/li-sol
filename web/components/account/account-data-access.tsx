'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
    createAmountToUiAmountInstruction,
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

export function useAmountToUiAmount(tokenInfo: { mint: string; owner: string; tokenAmount: { uiAmount: number; amount: string; decimals: number } }) {
  const { connection } = useConnection();
  const { wallet, publicKey, signTransaction } = useWallet();
  const mint = new PublicKey(tokenInfo.mint);
  const amount = Number(tokenInfo.tokenAmount.amount);
  const programId = TOKEN_2022_PROGRAM_ID;

  return useQuery({
    queryKey: ['amount-to-ui-amount', { amount: tokenInfo.tokenAmount.amount, endpoint: connection.rpcEndpoint }],
    queryFn: async () => {
      if (!wallet || !publicKey || !signTransaction) {
        throw new Error('Wallet not connected or does not support signing');
      }

      const transaction = new Transaction().add(createAmountToUiAmountInstruction(mint, amount, programId));
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      
      // Sign the transaction using the wallet adapter
      const signedTransaction = await signTransaction(transaction);
      
      // Simulate the transaction
      const { returnData, err } = (await connection.simulateTransaction(signedTransaction)).value;
      
      if (returnData?.data) {
        return Buffer.from(returnData.data[0], returnData.data[1]).toString('utf-8');
      }
      if (err) {
        throw new Error(err.toString());
      }
      return null;
    },
    enabled: !!wallet && !!publicKey && !!signTransaction, // Only enable the query if all dependencies are available
  });
}

// Custom hook to fetch uiAmounts for token accounts
export function useTokenAccountsUiAmounts(items: { pubkey: PublicKey; account: AccountInfo<ParsedAccountData>; }[]) {
  const { connection } = useConnection();
  const { wallet, publicKey, signTransaction } = useWallet();
  const [uiAmounts, setUiAmounts] = useState<{ [key: string]: string | null }>({});

  useEffect(() => {
    if (items && wallet && publicKey && signTransaction) {
      items.forEach(({ account, pubkey }) => {
        const mint = new PublicKey(account.data.parsed.info.mint);
        const amount = Number(account.data.parsed.info.tokenAmount.amount);
        const programId = TOKEN_2022_PROGRAM_ID;

        const fetchUiAmount = async () => {
          const transaction = new Transaction().add(createAmountToUiAmountInstruction(mint, amount, programId));
          transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
          transaction.feePayer = publicKey;
          const signedTransaction = await signTransaction(transaction);

          const { returnData, err } = (await connection.simulateTransaction(signedTransaction)).value;

          if (returnData?.data) {
            const uiAmount = Buffer.from(returnData.data[0], returnData.data[1]).toString('utf-8');
            setUiAmounts((prev) => ({ ...prev, [pubkey.toString()]: uiAmount }));
          } else if (err) {
            setUiAmounts((prev) => ({ ...prev, [pubkey.toString()]: null }));
          }
        };

        fetchUiAmount();
      });
    }
  }, [items, wallet, publicKey, signTransaction, connection]);

  return uiAmounts;
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
