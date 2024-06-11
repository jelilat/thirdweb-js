import "server-only";

import { THIRDWEB_API_HOST } from "constants/urls";
import { ChainMetadataWithServices } from "./types/chain";
import { redirect } from "next/navigation";
import type { ChainCTAProps } from "./[chain_id]/components/server/cta-card";
// TEMPORARY
import xaiBanner from "./temp-assets/xai-banner.jpg";
import baseBanner from "./temp-assets/base-banner.jpeg";
import superchainCTABG from "./temp-assets/cta-bg-superchain.png";
import xaiCTABg from "./temp-assets/cta-bg-xai-connect.png";
// END TEMPORARY

export async function getChains() {
  const response = await fetch(
    `${THIRDWEB_API_HOST}/v1/chains?includeServices=true`,
    { next: { revalidate: 3600 } },
  );

  if (!response.ok) {
    response.body?.cancel();
    throw new Error("Failed to fetch chains");
  }
  return (await response.json()).data as ChainMetadataWithServices[];
}

export async function getChain(
  chainIdOrSlug: string,
): Promise<ChainMetadataWithServices> {
  const res = await fetch(
    `${THIRDWEB_API_HOST}/v1/chains/${chainIdOrSlug}?includeServices=true`,
  );

  const result = await res.json();
  if (!result.data) {
    redirect("/404");
  }
  return result.data as ChainMetadataWithServices;
}

type ChainMetadata = Partial<{
  headerImgUrl: string;
  about: string;
  gasSponsored: boolean;
  verified: boolean;
  cta: ChainCTAProps;
}>;

// TEMPORARY

const OP_CTA = {
  backgroundImageUrl: superchainCTABG.src,
  title: "Optimism Superchain App Accelerator",
  description:
    "Successful applicants receive gas grants for use across all supported Optimism Superchain networks. These grants can sponsor gas fees for any onchain activity using our Account Abstraction tools.",
  buttonText: "Apply now",
  buttonLink: "/dashboard/settings/gas-credits",
} satisfies ChainCTAProps;

const chainMetaRecord = {
  // XAI
  660279: {
    headerImgUrl: xaiBanner.src,
    about:
      "Xai was developed to enable real economies and open trade in the next generation of video games. With Xai, potentially billions of traditional gamers can own and trade valuable in-game items in their favorite games for the first time, without the need to use crypto-wallets.",
    verified: true,
    cta: {
      title: "Unlock ultimate possibility with Xai Connect",
      backgroundImageUrl: xaiCTABg.src,
      buttonLink: "https://connect.xai.games",
      buttonText: "Learn more",
    },
  },
  // base
  8453: {
    headerImgUrl: baseBanner.src,
    about:
      "Base is a secure, low-cost, builder-friendly Ethereum L2 built to bring the next billion users onchain.",
    gasSponsored: true,
    verified: true,
    cta: OP_CTA,
  },
  // optimism
  10: {
    cta: OP_CTA,
    gasSponsored: true,
  },
  // fraxtal
  252: {
    cta: OP_CTA,
    gasSponsored: true,
  },
  // zora
  7777777: {
    cta: OP_CTA,
    gasSponsored: true,
  },
  // mode
  34443: {
    cta: OP_CTA,
    gasSponsored: true,
  },
  // cyber
  7560: {
    cta: OP_CTA,
    gasSponsored: true,
  },
  // redstone
  690: {
    cta: OP_CTA,
    gasSponsored: true,
  },
} satisfies Record<number, ChainMetadata>;
// END TEMPORARY

export async function getChainMetadata(
  chainId: number,
): Promise<ChainMetadata | null> {
  // TODO: fetch this from the API
  if (chainId in chainMetaRecord) {
    return chainMetaRecord[chainId as keyof typeof chainMetaRecord];
  }
  return null;
}
