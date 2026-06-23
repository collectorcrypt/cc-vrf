/// <reference types="vite/client" />

declare module "*.css";

interface ImportMetaEnv {
  readonly VITE_CC_VRF_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
