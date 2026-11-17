// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IMarket {
    function list(bytes32 id, uint256 price, bytes32[] calldata proof) external;
    function withdrawProceeds(address payable recipient) external;
}

contract TestSeller {
    IMarket public immutable market;
    bool public rejectPayments;
    bool public tryReentry;
    bool public reentrySucceeded;

    event ethscriptions_protocol_TransferEthscription(address indexed recipient, bytes32 indexed ethscriptionId);

    constructor(IMarket target) { market = target; }

    function depositAndList(bytes32 id, uint256 price, bytes32[] calldata proof) external {
        emit ethscriptions_protocol_TransferEthscription(address(market), id);
        (bool ok,) = address(market).call(abi.encode(id));
        require(ok, "deposit failed");
        market.list(id, price, proof);
    }

    function configure(bool reject, bool reenter) external {
        rejectPayments = reject;
        tryReentry = reenter;
    }

    function withdrawTo(address payable recipient) external { market.withdrawProceeds(recipient); }

    receive() external payable {
        require(!rejectPayments, "rejected");
        if (tryReentry) {
            (reentrySucceeded,) = address(market).call(
                abi.encodeCall(IMarket.withdrawProceeds, (payable(address(this))))
            );
        }
    }
}
