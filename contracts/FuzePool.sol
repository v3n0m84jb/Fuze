// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FuzePool {

    IERC20 public token;

    address public factory;
    address public creator;
    address public treasury;

    uint256 public reserveMON;

    uint256 public constant BUY_FEE = 1;
    uint256 public constant SELL_FEE = 1;

    uint256 public constant FEE_DENOMINATOR = 100;

    uint256 public constant IGNITION_TARGET = 0.2 ether;

    uint256 public constant BASE_PRICE = 1e12;
    uint256 public constant PRICE_SLOPE = 1e6;

    uint256 public tokensSold;

    bool public ignited;

    event Bought(
        address indexed buyer,
        uint256 monSpent,
        uint256 tokensReceived
    );

    event Sold(
        address indexed seller,
        uint256 tokensSold,
        uint256 monReceived
    );

    event Ignited(
        uint256 reserveMON
    );

    constructor(
        address token_,
        address creator_,
        address treasury_
    ) {
        token = IERC20(token_);

        factory = msg.sender;
        creator = creator_;
        treasury = treasury_;
    }

    function currentPrice()
        public
        view
        returns (uint256)
    {
        return BASE_PRICE +
            ((tokensSold / 1 ether) * PRICE_SLOPE);
    }

    function getBuyQuote(uint256 monAmount)
        public
        view
        returns (uint256)
    {
        uint256 fee =
            (monAmount * BUY_FEE) / FEE_DENOMINATOR;

        uint256 effectiveMON =
            monAmount - fee;

        uint256 price =
            currentPrice();

        return
            (effectiveMON * 1 ether) / price;
    }

    function getSellQuote(uint256 tokenAmount)
        public
        view
        returns (uint256)
    {
        uint256 price =
            currentPrice();

        uint256 grossMON =
            (tokenAmount * price) / 1 ether;

        uint256 fee =
            (grossMON * SELL_FEE) / FEE_DENOMINATOR;

        return grossMON - fee;
    }

    function buy(uint256 minTokensOut)
        external
        payable
    {
        require(!ignited, "Already ignited");
        require(msg.value > 0, "No MON sent");

        uint256 tokenAmount =
            getBuyQuote(msg.value);

        require(
            tokenAmount >= minTokensOut,
            "Slippage exceeded"
        );

        uint256 fee =
            (msg.value * BUY_FEE) / FEE_DENOMINATOR;

        uint256 effectiveMON =
            msg.value - fee;

        reserveMON += effectiveMON;

        tokensSold += tokenAmount;

        payable(treasury).transfer(fee);

        require(
            token.transfer(
                msg.sender,
                tokenAmount
            ),
            "Transfer failed"
        );

        emit Bought(
            msg.sender,
            effectiveMON,
            tokenAmount
        );

        if (reserveMON >= IGNITION_TARGET) {

            ignited = true;

            emit Ignited(reserveMON);
        }
    }

    function sell(
        uint256 tokenAmount,
        uint256 minMonOut
    )
        external
    {
        require(
            tokenAmount > 0,
            "Invalid amount"
        );

        uint256 payout =
            getSellQuote(tokenAmount);

        require(
            payout >= minMonOut,
            "Slippage exceeded"
        );

        require(
            reserveMON >= payout,
            "Insufficient reserve"
        );

        require(
            token.transferFrom(
                msg.sender,
                address(this),
                tokenAmount
            ),
            "Transfer failed"
        );

        reserveMON -= payout;

        tokensSold -= tokenAmount;

        payable(msg.sender).transfer(payout);

        emit Sold(
            msg.sender,
            tokenAmount,
            payout
        );
    }
}