// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract FuzeToken is ERC20, Ownable {
    address public creator;
    uint256 public createdAt;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address creator_
    )
        ERC20(name_, symbol_)
        Ownable(creator_)
    {
        creator = creator_;
        createdAt = block.timestamp;

        // Mint naar factory, zodat factory alles naar de pool kan sturen
        _mint(msg.sender, totalSupply_);
    }
}