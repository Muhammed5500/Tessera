// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title KAHIN PredictionMarket
/// @notice Agent tarafından açılan ve ATK verisiyle çözülen parimutuel olasılık piyasası.
/// @dev Bkz. docs/MIMARI.md §6. `params` kontratta yorumlanmaz; şablon kuralı agent/verify kodundadır.
contract PredictionMarket is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Active,
        Proposed,
        Disputed,
        Finalized
    }

    enum Outcome {
        Unresolved,
        Yes,
        No,
        Void
    }

    struct Market {
        uint8 templateId;
        bytes params;
        string question;
        string metadataURI;
        uint64 createdAt;
        uint64 closeTime;
        uint64 resolveTime;
        uint64 proposedAt;
        Status status;
        Outcome proposedOutcome;
        Outcome finalOutcome;
        uint256 yesPool;
        uint256 noPool;
        uint256 fee; // finalize'da hazineye giden ücret (claim hesabı için saklanır)
        bytes32 evidenceHash;
        string evidenceURI;
        address disputer;
    }

    uint8 public constant MAX_TEMPLATE_ID = 5;
    uint16 public constant MAX_FEE_BPS = 1_000; // %10 üst sınır

    IERC20 public immutable token;

    address public agent;
    address public treasury;
    uint16 public feeBps = 100;
    uint64 public disputeWindow = 300;
    uint64 public minResolveGap = 120;
    uint64 public proposeDeadline = 2 hours;
    uint256 public disputeBond = 10e6;
    uint256 public minBet = 1e6;

    uint256 public marketCount;
    mapping(uint256 => Market) internal _markets;
    mapping(uint256 => mapping(address => uint256)) public yesStake;
    mapping(uint256 => mapping(address => uint256)) public noStake;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event MarketCreated(
        uint256 indexed id,
        uint8 templateId,
        bytes params,
        string question,
        string metadataURI,
        uint64 closeTime,
        uint64 resolveTime
    );
    event BetPlaced(uint256 indexed id, address indexed user, bool yes, uint256 amount);
    event ResolutionProposed(uint256 indexed id, Outcome outcome, bytes32 evidenceHash, string evidenceURI);
    event Disputed(uint256 indexed id, address indexed disputer);
    event DisputeResolved(uint256 indexed id, Outcome outcome, bool bondRefunded);
    event Finalized(uint256 indexed id, Outcome outcome, uint256 fee);
    event Claimed(uint256 indexed id, address indexed user, uint256 amount);
    event AgentUpdated(address agent);
    event TreasuryUpdated(address treasury);
    event ParamsUpdated(
        uint16 feeBps,
        uint64 disputeWindow,
        uint64 minResolveGap,
        uint64 proposeDeadline,
        uint256 disputeBond,
        uint256 minBet
    );

    error NotAgent();
    error ZeroAddress();
    error InvalidTemplate();
    error EmptyParams();
    error InvalidTimes();
    error UnknownMarket();
    error WrongStatus();
    error BettingClosed();
    error BetTooSmall();
    error TooEarly();
    error TooLate();
    error InvalidOutcome();
    error EmptyEvidence();
    error NothingToClaim();
    error AlreadyClaimed();
    error InvalidParams();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier exists(uint256 id) {
        if (id == 0 || id > marketCount) revert UnknownMarket();
        _;
    }

    constructor(IERC20 token_, address agent_, address treasury_, address owner_) Ownable(owner_) {
        if (address(token_) == address(0) || agent_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        token = token_;
        agent = agent_;
        treasury = treasury_;
    }

    // ------------------------------------------------------------------
    // Agent
    // ------------------------------------------------------------------

    function createMarket(
        uint8 templateId,
        bytes calldata params,
        string calldata question,
        string calldata metadataURI,
        uint64 closeTime,
        uint64 resolveTime
    ) external onlyAgent whenNotPaused returns (uint256 id) {
        if (templateId == 0 || templateId > MAX_TEMPLATE_ID) revert InvalidTemplate();
        if (params.length == 0) revert EmptyParams();
        if (closeTime <= block.timestamp || resolveTime < closeTime + minResolveGap) revert InvalidTimes();

        id = ++marketCount;
        Market storage m = _markets[id];
        m.templateId = templateId;
        m.params = params;
        m.question = question;
        m.metadataURI = metadataURI;
        m.createdAt = uint64(block.timestamp);
        m.closeTime = closeTime;
        m.resolveTime = resolveTime;
        // status = Active (0), outcome'lar = Unresolved (0)

        emit MarketCreated(id, templateId, params, question, metadataURI, closeTime, resolveTime);
    }

    function proposeResolution(uint256 id, Outcome outcome, bytes32 evidenceHash, string calldata evidenceURI)
        external
        onlyAgent
        exists(id)
    {
        Market storage m = _markets[id];
        if (m.status != Status.Active) revert WrongStatus();
        if (block.timestamp < m.resolveTime) revert TooEarly();
        if (outcome == Outcome.Unresolved) revert InvalidOutcome();
        if (evidenceHash == bytes32(0)) revert EmptyEvidence();

        m.status = Status.Proposed;
        m.proposedOutcome = outcome;
        m.proposedAt = uint64(block.timestamp);
        m.evidenceHash = evidenceHash;
        m.evidenceURI = evidenceURI;

        emit ResolutionProposed(id, outcome, evidenceHash, evidenceURI);
    }

    // ------------------------------------------------------------------
    // Kullanıcılar (insan veya agent — kontrat ayırt etmez)
    // ------------------------------------------------------------------

    function bet(uint256 id, bool yes, uint256 amount) external nonReentrant whenNotPaused exists(id) {
        Market storage m = _markets[id];
        if (m.status != Status.Active || block.timestamp >= m.closeTime) revert BettingClosed();
        if (amount < minBet) revert BetTooSmall();

        if (yes) {
            m.yesPool += amount;
            yesStake[id][msg.sender] += amount;
        } else {
            m.noPool += amount;
            noStake[id][msg.sender] += amount;
        }

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit BetPlaced(id, msg.sender, yes, amount);
    }

    function dispute(uint256 id) external nonReentrant exists(id) {
        Market storage m = _markets[id];
        if (m.status != Status.Proposed) revert WrongStatus();
        if (block.timestamp >= m.proposedAt + disputeWindow) revert TooLate();

        m.status = Status.Disputed;
        m.disputer = msg.sender;

        token.safeTransferFrom(msg.sender, address(this), disputeBond);
        emit Disputed(id, msg.sender);
    }

    /// @notice İtiraz süresi dolan öneriyi kesinleştirir. Herkes çağırabilir.
    function finalize(uint256 id) external nonReentrant exists(id) {
        Market storage m = _markets[id];
        if (m.status != Status.Proposed) revert WrongStatus();
        if (block.timestamp < m.proposedAt + disputeWindow) revert TooEarly();
        _settle(id, m.proposedOutcome);
    }

    /// @notice Agent `proposeDeadline` içinde öneri yapmadıysa marketi geçersiz sayar. Herkes çağırabilir.
    function voidStale(uint256 id) external nonReentrant exists(id) {
        Market storage m = _markets[id];
        if (m.status != Status.Active) revert WrongStatus();
        if (block.timestamp <= uint256(m.resolveTime) + proposeDeadline) revert TooEarly();
        _settle(id, Outcome.Void);
    }

    function claim(uint256 id) external nonReentrant exists(id) {
        Market storage m = _markets[id];
        if (m.status != Status.Finalized) revert WrongStatus();
        if (claimed[id][msg.sender]) revert AlreadyClaimed();

        uint256 amount = _payout(m, yesStake[id][msg.sender], noStake[id][msg.sender]);
        if (amount == 0) revert NothingToClaim();

        claimed[id][msg.sender] = true;
        token.safeTransfer(msg.sender, amount);
        emit Claimed(id, msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Owner / komite
    // ------------------------------------------------------------------

    /// @notice İtirazlı marketi karara bağlar. Öneri bozulursa teminat itiraz edene, aksi halde hazineye.
    function resolveDispute(uint256 id, Outcome outcome) external onlyOwner nonReentrant exists(id) {
        Market storage m = _markets[id];
        if (m.status != Status.Disputed) revert WrongStatus();
        if (outcome == Outcome.Unresolved) revert InvalidOutcome();

        bool refund = outcome != m.proposedOutcome;
        address bondTo = refund ? m.disputer : treasury;

        _settle(id, outcome);
        token.safeTransfer(bondTo, disputeBond);
        emit DisputeResolved(id, outcome, refund);
    }

    function setAgent(address agent_) external onlyOwner {
        if (agent_ == address(0)) revert ZeroAddress();
        agent = agent_;
        emit AgentUpdated(agent_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setParams(
        uint16 feeBps_,
        uint64 disputeWindow_,
        uint64 minResolveGap_,
        uint64 proposeDeadline_,
        uint256 disputeBond_,
        uint256 minBet_
    ) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS || minBet_ == 0) revert InvalidParams();
        feeBps = feeBps_;
        disputeWindow = disputeWindow_;
        minResolveGap = minResolveGap_;
        proposeDeadline = proposeDeadline_;
        disputeBond = disputeBond_;
        minBet = minBet_;
        emit ParamsUpdated(feeBps_, disputeWindow_, minResolveGap_, proposeDeadline_, disputeBond_, minBet_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ------------------------------------------------------------------
    // View
    // ------------------------------------------------------------------

    function getMarket(uint256 id) external view exists(id) returns (Market memory) {
        return _markets[id];
    }

    function getPosition(uint256 id, address user) external view returns (uint256 yes, uint256 no, bool hasClaimed) {
        return (yesStake[id][user], noStake[id][user], claimed[id][user]);
    }

    /// @notice Kesinleşmiş markette kullanıcının alacağı tutar (claim edildiyse 0).
    function previewPayout(uint256 id, address user) external view exists(id) returns (uint256) {
        Market storage m = _markets[id];
        if (m.status != Status.Finalized || claimed[id][user]) return 0;
        return _payout(m, yesStake[id][user], noStake[id][user]);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    /// @dev Tek taraflı market veya kazanan tarafı boş market → Void. Ücret yalnız Yes/No sonucunda alınır.
    function _settle(uint256 id, Outcome outcome) internal {
        Market storage m = _markets[id];
        if (m.yesPool == 0 || m.noPool == 0) outcome = Outcome.Void;

        m.status = Status.Finalized;
        m.finalOutcome = outcome;

        uint256 fee;
        if (outcome != Outcome.Void) {
            fee = ((m.yesPool + m.noPool) * feeBps) / 10_000;
            m.fee = fee;
            if (fee > 0) token.safeTransfer(treasury, fee);
        }
        emit Finalized(id, outcome, fee);
    }

    function _payout(Market storage m, uint256 yesAmt, uint256 noAmt) internal view returns (uint256) {
        if (m.finalOutcome == Outcome.Void) return yesAmt + noAmt;
        uint256 distributable = m.yesPool + m.noPool - m.fee;
        if (m.finalOutcome == Outcome.Yes) return (yesAmt * distributable) / m.yesPool;
        if (m.finalOutcome == Outcome.No) return (noAmt * distributable) / m.noPool;
        return 0;
    }
}
