import {
  CommonNFTInput,
  NFT,
  NFTMetadata,
  NFTMetadataInput,
} from "../../core/schema/nft";
import { ClaimConditions } from "../classes/claim-conditions";
import { NFTHelper } from "../classes/helpers/nft-helper";
import { Amount, TransactionResult } from "../types/common";
import {
  CandyMachineItem,
  Metaplex,
  MintCandyMachineOutput,
  toBigNumber,
} from "@metaplex-foundation/js";
import { PublicKey } from "@solana/web3.js";
import { ThirdwebStorage, UploadProgressEvent } from "@thirdweb-dev/storage";
import invariant from "tiny-invariant";

const LAZY_MINT_BATCH_SIZE = 5;

/**
 * A collection of NFTs that can be lazy minted and claimed
 *
 * @example
 * ```jsx
 * import { ThirdwebSDK } from "@thirdweb-dev/sdk/solana";
 *
 * const sdk = ThirdwebSDK.fromNetwork("devnet");
 * sdk.wallet.connect(signer);
 *
 * // Get the interface for your NFT Drop program
 * const program = await sdk.getProgram("{{program_address}}", "nft-drop");
 * ```
 *
 * @public
 */
export class NFTDrop {
  private metaplex: Metaplex;
  private storage: ThirdwebStorage;
  private nft: NFTHelper;
  public accountType = "nft-drop" as const;
  public publicKey: PublicKey;
  public get network() {
    const url = new URL(this.metaplex.connection.rpcEndpoint);
    // try this first to avoid hitting `custom` network for alchemy urls
    if (url.hostname.includes("devnet")) {
      return "devnet";
    }
    if (url.hostname.includes("mainnet")) {
      return "mainnet-beta";
    }
    return this.metaplex.cluster;
  }

  /**
   * Manage the claim conditions for this drop
   *
   * @example
   * ```jsx
   * // set your claim conditions
   * await program.claimConditions.set({
   *  maxClaimable: 100,
   *  price: 0.5,
   *  startTime: new Date(),
   * });
   *
   * // get your claim conditions
   * const conditions = await program.claimConditions.get();
   * console.log(conditions.maxClaimable);
   * console.log(conditions.claimedSupply);
   * ```
   */
  public claimConditions: ClaimConditions;

  constructor(
    dropAddress: string,
    metaplex: Metaplex,
    storage: ThirdwebStorage,
  ) {
    this.storage = storage;
    this.metaplex = metaplex;
    this.nft = new NFTHelper(metaplex);
    this.publicKey = new PublicKey(dropAddress);
    this.claimConditions = new ClaimConditions(dropAddress, metaplex);
  }

  /**
   * Get the metadata for this program.
   * @returns program metadata
   *
   * @example
   * ```jsx
   * const metadata = await program.getMetadata();
   * console.log(metadata.name);
   * ```
   */
  async getMetadata(): Promise<NFTMetadata> {
    const info = await this.getCandyMachine();
    invariant(info.collectionMintAddress, "Collection mint address not found");
    const metadata = await this.metaplex
      .nfts()
      .findByMint({ mintAddress: info.collectionMintAddress })
      .run();
    return (await this.nft.toNFTMetadata(metadata)).metadata;
  }

  /**
   * Get the metadata for a specific NFT
   * @param nftAddress - the mint address of the NFT to get
   * @returns the metadata of the NFT
   *
   * @example
   * ```jsx
   * // Specify the mint address of the NFT to get the data of
   * const nftAddress = "...";
   * // And get the data for the NFT
   * const nft = await program.get(nftAddress);
   *
   * console.log(nft.name);
   * ```
   */
  async get(nftAddress: string): Promise<NFT> {
    return this.nft.get(nftAddress);
  }

  /**
   * Get the metadata for all NFTs on this drop
   * @returns metadata for all minted NFTs
   *
   * @example
   * ```jsx
   * // Get all the NFTs that have been minted on this contract
   * const nfts = await program.getAll();
   *
   * console.log(nfts[0].metadata.name);
   * ```
   */
  async getAll(): Promise<NFT[]> {
    // TODO: Add pagination to get NFT functions
    const info = await this.getCandyMachine();
    const claimed = await this.getAllClaimed();
    return await Promise.all(
      info.items.map(async (item) => {
        // Check if the NFT has been claimed
        // TODO: This only checks name/uri which is potentially not unique
        const claimedNFT = claimed.find(
          (nft) =>
            nft.metadata.name === item.name && nft.metadata.uri === item.uri,
        );
        if (claimedNFT) {
          return claimedNFT;
        }
        // not claimed yet, return a unclaimed NFT with just the metadata
        const metadata: NFTMetadata = await this.storage.downloadJSON(item.uri);
        return {
          metadata: {
            ...metadata,
            id: PublicKey.default.toBase58(),
            uri: item.uri,
          },
          owner: PublicKey.default.toBase58(),
          supply: 0,
          type: "metaplex",
        } as NFT;
      }),
    );
  }

  /**
   * Get the metadata for all the claimed NFTs on this drop
   * @returns metadata for all claimed NFTs
   *
   * @example
   * ```jsx
   * // Get all the NFTs that have already been claimed from this drop
   * const nfts = await program.getAllClaimed();
   * console.log(nfts[0].name)
   * ```
   */
  async getAllClaimed(): Promise<NFT[]> {
    // using getAll from collection here because candy machin findAllMinted doesn't return anything
    const candy = await this.getCandyMachine();
    invariant(candy.collectionMintAddress, "Collection mint address not found");
    return await this.nft.getAll(candy.collectionMintAddress.toBase58());
  }

  /**
   * Get the NFT balance of the connected wallet
   * @returns the NFT balance
   *
   * @example
   * ```jsx
   * // The mint address of the NFT to check the balance of
   * const nftAddress = "..."
   * // Get the NFT balance of the currently connected wallet
   * const balance = await program.balance(nftAddress);
   * console.log(balance);
   * ```
   */
  async balance(nftAddress: string): Promise<number> {
    const address = this.metaplex.identity().publicKey.toBase58();
    return this.balanceOf(address, nftAddress);
  }

  /**
   * Get the NFT balance of the specified wallet
   * @param walletAddress - the wallet address to get the balance of
   * @param nftAddress - the mint address of the NFT to get the balance of
   * @returns the NFT balance
   *
   * @example
   * ```jsx
   * // The address of the wallet to check the balance of
   * const walletAddress = "..."
   * // The mint address of the NFT to check the balance of
   * const nftAddress = "..."
   * // Get the actual NFT balance of the specified wallet
   * const balance = await program.balanceOf(walletAddress, nftAddress);
   * ```
   */
  async balanceOf(walletAddress: string, nftAddress: string): Promise<number> {
    return this.nft.balanceOf(walletAddress, nftAddress);
  }

  /**
   * Get the total unclaimed supply of this drop
   * @returns the total supply
   *
   * @example
   * ```jsx
   * // Get the total number of lazy minted NFTs that aren't yet claimed
   * const supply = await program.totalUnclaimedSupply();
   * ```
   */
  async totalUnclaimedSupply(): Promise<number> {
    const info = await this.getCandyMachine();
    return Math.min(
      info.itemsLoaded.toNumber(),
      info.itemsRemaining.toNumber(),
    );
  }

  /**
   * Get the total claimed supply of this drop
   * @returns the total supply
   *
   * @example
   * ```jsx
   * // Get the total number of lazy minted NFTs that have already been claimed
   * const supply = await program.totalClaimedSupply();
   * ```
   */
  async totalClaimedSupply(): Promise<number> {
    const info = await this.getCandyMachine();
    return info.itemsMinted.toNumber();
  }

  /**
   * Transfer the specified NFTs to another wallet
   * @param receiverAddress - The address to send the tokens to
   * @param nftAddress - The mint address of the NFT to transfer
   * @returns the transaction result of the transfer
   *
   * @example
   * ```jsx
   * // The wallet address to transfer the NFTs to
   * const to = "...";
   * // The mint address of the NFT to transfer
   * const nftAddress = "...";
   * const tx = await program.transfer(to, nftAddress);
   * ```
   */
  async transfer(
    receiverAddress: string,
    nftAddress: string,
  ): Promise<TransactionResult> {
    return this.nft.transfer(receiverAddress, nftAddress);
  }

  /**
   * Lazy mint NFTs to be claimed later
   * @param metadatas - The metadata of the NFTs to lazy mint
   * @returns the transaction result of the lazy mint
   *
   * @example
   * ```jsx
   * // Add the metadata of your NFTs
   * const metadata = [
   *   {
   *     name: "NFT #1",
   *     description: "My first NFT!",
   *     image: readFileSync("files/image.jpg"),
   *     properties: [
   *       {
   *         name: "coolness",
   *         value: "very cool!"
   *       }
   *     ]
   *   }
   * ];
   *
   * // And lazy mint NFTs to your program
   * const tx = await program.lazyMint(metadatas);
   * ```
   */
  async lazyMint(
    metadatas: NFTMetadataInput[],
    options?: {
      onProgress: (event: UploadProgressEvent) => void;
    },
  ): Promise<TransactionResult[]> {
    const candyMachine = await this.getCandyMachine();
    const parsedMetadatas = metadatas.map((metadata) =>
      CommonNFTInput.parse(metadata),
    );
    const uris = await this.storage.uploadBatch(parsedMetadatas, options);
    const items: CandyMachineItem[] = uris.map((uri, i) => ({
      name: parsedMetadatas[i].name?.toString() || "",
      uri,
    }));

    // turn items into batches of $LAZY_MINT_BATCH_SIZE
    const batches: CandyMachineItem[][] = [];
    while (items.length) {
      batches.push(items.splice(0, LAZY_MINT_BATCH_SIZE));
    }

    const block = await this.metaplex.connection.getLatestBlockhash();

    const txns = batches.map((batch, i) =>
      this.metaplex
        .candyMachines()
        .builders()
        .insertItems({
          candyMachine,
          authority: this.metaplex.identity(),
          items: batch,
          index: toBigNumber(
            i * LAZY_MINT_BATCH_SIZE + candyMachine.itemsLoaded.toNumber(),
          ),
        })
        .setTransactionOptions({
          blockhash: block.blockhash,
          feePayer: this.metaplex.identity().publicKey,
          lastValidBlockHeight: block.lastValidBlockHeight,
        })
        .setFeePayer(this.metaplex.identity())
        .toTransaction(),
    );

    // make the connected wallet sign both candyMachine + registry transactions
    const signedTx = await this.metaplex.identity().signAllTransactions(txns);

    // send the signed transactions
    const signatures = await Promise.all(
      signedTx.map((tx) =>
        this.metaplex.connection.sendRawTransaction(tx.serialize()),
      ),
    );

    // wait for confirmations in parallel
    const confirmations = await Promise.all(
      signatures.map((sig) => {
        return this.metaplex.rpc().confirmTransaction(sig);
      }),
    );

    if (confirmations.length === 0) {
      throw new Error("Transaction failed");
    }

    return signatures.map((signature) => ({ signature }));
  }

  /**
   * Claim an NFT from the drop with connected wallet
   * @returns - the mint address of the claimed NFT
   *
   * @example
   * ```jsx
   * // Specify the quantity of NFTs to claim
   * const quantity = 1;
   * // Claim NFTs and get their mint addresses
   * const claimedAddresses = await program.claim(quantity);
   * console.log("Claimed NFT at address", claimedAddresses[0]);
   * ```
   */
  async claim(quantity: Amount): Promise<string[]> {
    const address = this.metaplex.identity().publicKey.toBase58();
    return this.claimTo(address, quantity);
  }

  /**
   * Claim an NFT from the drop for the specified wallet
   * @returns - the mint address of the claimed NFT
   *
   * @example
   * ```jsx
   * // Specify which address to claim the NFTs to
   * const receiverAddress =  "...";
   * // Claim the NFTs to the specified wallet and get the mint addresses of the NFTs
   * const claimedAddresses = await program.claimTo(receiverAddress, 1);
   * console.log("Claimed NFT at address", claimedAddresses[0]);
   * ```
   */
  async claimTo(receiverAddress: string, quantity: Amount): Promise<string[]> {
    const candyMachine = await this.getCandyMachine();
    await this.claimConditions.assertCanClaimable(Number(quantity));
    const results: MintCandyMachineOutput[] = [];
    // has to claim sequentially
    for (let i = 0; i < quantity; i++) {
      results.push(
        await this.metaplex
          .candyMachines()
          .mint({ candyMachine, newOwner: new PublicKey(receiverAddress) })
          .run(),
      );
    }
    return results.map((result) => result.nft.address.toBase58());
  }

  /**
   * Burn an NFT
   * @param nftAddress - the mint address of the NFT to burn
   * @returns the transaction signature
   *
   * @example
   * ```jsx
   * // Specify the address of the NFT to burn
   * const nftAddress = "..."
   * // And send the actual burn transaction
   * const tx = await program.burn(nftAddress);
   * ```
   */
  async burn(nftAddress: string): Promise<TransactionResult> {
    const candyMachine = await this.getCandyMachine();
    const collection = candyMachine.collectionMintAddress
      ? candyMachine.collectionMintAddress
      : undefined;
    const tx = await this.metaplex
      .nfts()
      .delete({
        mintAddress: new PublicKey(nftAddress),
        collection,
      })
      .run();
    return {
      signature: tx.response.signature,
    };
  }

  private async getCandyMachine() {
    return this.metaplex
      .candyMachines()
      .findByAddress({ address: this.publicKey })
      .run();
  }
}
