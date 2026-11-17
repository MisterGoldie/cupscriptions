// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed-price ETH market for the immutable Cupscriptions collection.
/// @dev Potential deposits are not proof of Ethscription ownership. A purchase
/// requires a buyer-bound authorization from an off-chain ownership verifier.
/// ESIP-2 withdrawals never depend on that verifier or an administrator.
contract CupscriptionsMarket is EIP712, ReentrancyGuard {
    uint256 public constant TRANSFER_COOLDOWN_BLOCKS = 5;
    uint256 public constant MAX_AUTHORIZATION_LIFETIME = 5 minutes;
    uint256 public constant MARKETPLACE_FEE = 0.000001 ether;
    address public constant feeRecipient = 0xcbBcf40247425932d728585dA2678567e7F8E42f;
    bytes32 public constant PURCHASE_TYPEHASH = keccak256(
        "PurchaseAuthorization(bytes32 ethscriptionId,address seller,address buyer,uint256 price,uint256 listingNonce,uint256 depositBlock,uint256 issuedAt,uint256 deadline)"
    );

    bytes32 public immutable collectionRoot;
    address public immutable ownershipVerifier;

    struct Listing {
        uint256 price;
        uint256 nonce;
    }

    struct PurchaseAuthorization {
        bytes32 ethscriptionId;
        address seller;
        address buyer;
        uint256 price;
        uint256 listingNonce;
        uint256 depositBlock;
        uint256 issuedAt;
        uint256 deadline;
    }

    // Deposits and listings are keyed by claimant. A false claimant must never
    // overwrite or block the real depositor's entries.
    mapping(address => mapping(bytes32 => uint256)) public potentialDeposits;
    mapping(address => mapping(bytes32 => Listing)) public listings;
    mapping(address => mapping(bytes32 => uint256)) public listingNonces;
    mapping(address => uint256) public proceeds;

    error InvalidConfiguration();
    error InvalidDeposit();
    error AlreadyDeposited();
    error NotDeposited();
    error NotInCollection();
    error InvalidPrice();
    error NotListed();
    error CooldownActive(uint256 readyAtBlock);
    error InvalidAuthorization();
    error WrongPayment();
    error InvalidRecipient();
    error NothingToWithdraw();
    error PaymentFailed();

    event PotentialDeposit(address indexed depositor, bytes32 indexed ethscriptionId, uint256 depositBlock);
    event Listed(address indexed seller, bytes32 indexed ethscriptionId, uint256 price, uint256 nonce);
    event ListingCancelled(address indexed seller, bytes32 indexed ethscriptionId, uint256 nonce);
    event Purchased(address indexed seller, address indexed buyer, bytes32 indexed ethscriptionId, uint256 price, uint256 fee, uint256 nonce);
    event PotentialWithdrawal(address indexed depositor, bytes32 indexed ethscriptionId);
    event ProceedsWithdrawn(address indexed account, address indexed recipient, uint256 amount);

    // The spelling, parameter order and indexed flags are mandated by ESIP-2.
    event ethscriptions_protocol_TransferEthscriptionForPreviousOwner(
        address indexed previousOwner,
        address indexed recipient,
        bytes32 indexed ethscriptionId
    );

    constructor(bytes32 root, address verifier)
        EIP712("CupscriptionsMarket", "1")
    {
        if (
            root == bytes32(0) || verifier == address(0) ||
            verifier == address(this)
        ) revert InvalidConfiguration();
        collectionRoot = root;
        ownershipVerifier = verifier;
    }

    /// @notice Deposit by sending 0 ETH with exactly the inscription ID as raw
    /// transaction calldata. Calling a named deposit(bytes32) function would not
    /// constitute an ordinary EOA Ethscription transfer under the protocol.
    fallback() external {
        if (msg.data.length != 32) revert InvalidDeposit();
        bytes32 id = abi.decode(msg.data, (bytes32));
        if (id == bytes32(0)) revert InvalidDeposit();
        if (potentialDeposits[msg.sender][id] != 0) revert AlreadyDeposited();
        potentialDeposits[msg.sender][id] = block.number;
        emit PotentialDeposit(msg.sender, id, block.number);
    }

    function isCollectionMember(bytes32 id, bytes32[] calldata proof) public view returns (bool) {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(id))));
        return MerkleProof.verifyCalldata(proof, collectionRoot, leaf);
    }

    /// @notice Create or reprice a listing. Indexers must check real ownership
    /// before advertising it; this transaction alone is only a potential offer.
    function list(bytes32 id, uint256 price, bytes32[] calldata proof) external {
        if (!isCollectionMember(id, proof)) revert NotInCollection();
        if (potentialDeposits[msg.sender][id] == 0) revert NotDeposited();
        if (price <= MARKETPLACE_FEE) revert InvalidPrice();
        uint256 nonce = ++listingNonces[msg.sender][id];
        listings[msg.sender][id] = Listing(price, nonce);
        emit Listed(msg.sender, id, price, nonce);
    }

    /// @notice Stop offering a cup for sale without moving it out of escrow.
    function cancelListing(bytes32 id) external {
        if (listings[msg.sender][id].price == 0) revert NotListed();
        delete listings[msg.sender][id];
        uint256 nonce = ++listingNonces[msg.sender][id];
        emit ListingCancelled(msg.sender, id, nonce);
    }

    /// @notice Cancel any listing and request return to the original depositor.
    /// No signature, service, collection proof, or administrator is required.
    /// Invalid claimants' events are ignored by Ethscriptions indexers.
    function withdrawEthscription(bytes32 id) external {
        _requireReady(msg.sender, id);
        delete potentialDeposits[msg.sender][id];
        delete listings[msg.sender][id];
        ++listingNonces[msg.sender][id];
        emit ethscriptions_protocol_TransferEthscriptionForPreviousOwner(msg.sender, msg.sender, id);
        emit PotentialWithdrawal(msg.sender, id);
    }

    /// @notice Buy at the exact listed price with a fresh ownership attestation.
    /// The verifier must confirm current owner == this contract, previous owner
    /// == seller, the latest deposit epoch, and the exact listing before signing.
    function buy(PurchaseAuthorization calldata authorization, bytes calldata signature)
        external payable nonReentrant
    {
        bytes32 id = authorization.ethscriptionId;
        address seller = authorization.seller;
        Listing memory listing = listings[seller][id];
        if (listing.price == 0) revert NotListed();
        if (
            authorization.buyer != msg.sender || seller == msg.sender ||
            authorization.price != listing.price ||
            authorization.listingNonce != listing.nonce ||
            authorization.depositBlock != potentialDeposits[seller][id] ||
            authorization.issuedAt > block.timestamp ||
            authorization.deadline < authorization.issuedAt ||
            authorization.deadline < block.timestamp ||
            authorization.deadline - authorization.issuedAt > MAX_AUTHORIZATION_LIFETIME
        ) revert InvalidAuthorization();
        _requireReady(seller, id);
        if (msg.value != listing.price) revert WrongPayment();
        if (ECDSA.recover(purchaseDigest(authorization), signature) != ownershipVerifier) {
            revert InvalidAuthorization();
        }

        delete listings[seller][id];
        delete potentialDeposits[seller][id];
        ++listingNonces[seller][id];
        uint256 fee = MARKETPLACE_FEE;
        proceeds[seller] += msg.value - fee;
        proceeds[feeRecipient] += fee;

        emit ethscriptions_protocol_TransferEthscriptionForPreviousOwner(seller, msg.sender, id);
        emit Purchased(seller, msg.sender, id, msg.value, fee, listing.nonce);
    }

    function purchaseDigest(PurchaseAuthorization calldata authorization) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            PURCHASE_TYPEHASH,
            authorization.ethscriptionId,
            authorization.seller,
            authorization.buyer,
            authorization.price,
            authorization.listingNonce,
            authorization.depositBlock,
            authorization.issuedAt,
            authorization.deadline
        )));
    }

    /// @notice Withdraw only your own credited ETH to an address you choose.
    /// A reverting seller/treasury cannot block purchases or other withdrawals.
    function withdrawProceeds(address payable recipient) external nonReentrant {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        uint256 amount = proceeds[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        proceeds[msg.sender] = 0;
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert PaymentFailed();
        emit ProceedsWithdrawn(msg.sender, recipient, amount);
    }

    function _requireReady(address depositor, bytes32 id) private view {
        uint256 depositedAt = potentialDeposits[depositor][id];
        if (depositedAt == 0) revert NotDeposited();
        uint256 readyAt = depositedAt + TRANSFER_COOLDOWN_BLOCKS;
        if (block.number < readyAt) revert CooldownActive(readyAt);
    }
}
