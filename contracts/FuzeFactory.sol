// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./FuzeToken.sol";
import "./FuzePool.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract FuzeFactory is Ownable {
    uint256 public constant CREATE_FEE = 1 ether;
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    address public treasury;

    struct TokenInfo {
        address token;
        address pool;
        address creator;
        string name;
        string symbol;
        uint256 createdAt;
    }

    TokenInfo[] public allTokens;

    mapping(address => bool) public isFuzeToken;
    mapping(address => address) public tokenToPool;
    mapping(address => address[]) public creatorTokens;

    event TokenCreated(
        address indexed token,
        address indexed pool,
        address indexed creator,
        string name,
        string symbol,
        uint256 timestamp
    );

    constructor(address treasury_) Ownable(msg.sender) {
        require(treasury_ != address(0), "Invalid treasury");
        treasury = treasury_;
    }

    function createToken(
        string calldata name,
        string calldata symbol
    ) external payable returns (address tokenAddress, address poolAddress) {
        require(msg.value == CREATE_FEE, "Invalid fee");
        require(bytes(name).length > 0, "Invalid name");
        require(bytes(symbol).length > 0, "Invalid symbol");

        FuzeToken token = new FuzeToken(
            name,
            symbol,
            INITIAL_SUPPLY,
            msg.sender
        );

        FuzePool pool = new FuzePool(
            address(token),
            msg.sender,
            treasury
        );

        tokenAddress = address(token);
        poolAddress = address(pool);

        require(
            token.transfer(poolAddress, INITIAL_SUPPLY),
            "Token transfer to pool failed"
        );

        allTokens.push(TokenInfo({
            token: tokenAddress,
            pool: poolAddress,
            creator: msg.sender,
            name: name,
            symbol: symbol,
            createdAt: block.timestamp
        }));

        isFuzeToken[tokenAddress] = true;
        tokenToPool[tokenAddress] = poolAddress;
        creatorTokens[msg.sender].push(tokenAddress);

        (bool sent, ) = payable(treasury).call{value: msg.value}("");
        require(sent, "Treasury transfer failed");

        emit TokenCreated(
            tokenAddress,
            poolAddress,
            msg.sender,
            name,
            symbol,
            block.timestamp
        );

        return (tokenAddress, poolAddress);
    }

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function getCreatorTokens(address creator)
        external
        view
        returns (address[] memory)
    {
        return creatorTokens[creator];
    }

    function updateTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        treasury = newTreasury;
    }
}