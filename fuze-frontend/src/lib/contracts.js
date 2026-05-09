export const FACTORY_ADDRESS = "0xBE22daf903Fa799AC1EfdCAA2880abe865692Ffe";

export const FACTORY_ABI = [
  "function createToken(string name, string symbol) payable",
  "function totalTokens() view returns (uint256)",
  "function allTokens(uint256) view returns (address token, address pool, address creator, string name, string symbol, uint256 createdAt)",
  "event TokenCreated(address indexed token, address indexed pool, address indexed creator, string name, string symbol, uint256 timestamp)"
];

export const FACTORY_READ_ABI = FACTORY_ABI;

export const POOL_ABI = [
  "function buy(uint256 minTokensOut) payable",
  "function sell(uint256 tokenAmount, uint256 minMonOut)",
  "function getBuyQuote(uint256 monAmount) view returns (uint256)",
  "function getSellQuote(uint256 tokenAmount) view returns (uint256)",
  "function currentPrice() view returns (uint256)",
  "function reserveMON() view returns (uint256)",
  "function tokensSold() view returns (uint256)",
  "function ignited() view returns (bool)"
];

export const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)"
];

export const CREATE_FEE = "1";
export const IGNITION_TARGET_MON = 0.2;