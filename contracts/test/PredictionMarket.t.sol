// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";

/// @dev docs/MIMARI.md §6.7'deki 10 zorunlu test + birkaç ek doğrulama.
contract PredictionMarketTest is Test {
    MockUSDC usdc;
    PredictionMarket pm;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint64 constant T0 = 1_792_200_000;
    uint64 constant CLOSE = T0 + 1800;
    uint64 constant RESOLVE = T0 + 2400;
    bytes constant PARAMS = abi.encode("global", "BTC-USDT", int256(81_000e8));
    bytes32 constant EVIDENCE = keccak256("evidence");

    PredictionMarket.Outcome constant YES = PredictionMarket.Outcome.Yes;
    PredictionMarket.Outcome constant NO = PredictionMarket.Outcome.No;
    PredictionMarket.Outcome constant VOID = PredictionMarket.Outcome.Void;

    function setUp() public {
        vm.warp(T0);
        usdc = new MockUSDC(owner);
        pm = new PredictionMarket(usdc, agent, treasury, owner);

        address[4] memory users = [alice, bob, carol, agent];
        for (uint256 i; i < users.length; i++) {
            vm.prank(owner);
            usdc.mint(users[i], 10_000e6);
            vm.prank(users[i]);
            usdc.approve(address(pm), type(uint256).max);
        }
    }

    // ------------------------------------------------------------------
    // Yardımcılar
    // ------------------------------------------------------------------

    function _create() internal returns (uint256 id) {
        vm.prank(agent);
        id = pm.createMarket(1, PARAMS, "BTC 81.000 $ ustunde mi?", "https://agent/meta", CLOSE, RESOLVE);
    }

    function _bet(address user, uint256 id, bool yes, uint256 amount) internal {
        vm.prank(user);
        pm.bet(id, yes, amount);
    }

    function _propose(uint256 id, PredictionMarket.Outcome o) internal {
        vm.warp(RESOLVE);
        vm.prank(agent);
        pm.proposeResolution(id, o, EVIDENCE, "https://agent/evidence/1.json");
    }

    function _proposeAndFinalize(uint256 id, PredictionMarket.Outcome o) internal {
        _propose(id, o);
        vm.warp(RESOLVE + pm.disputeWindow());
        pm.finalize(id);
    }

    function _claim(address user, uint256 id) internal returns (uint256 received) {
        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        pm.claim(id);
        received = usdc.balanceOf(user) - before;
    }

    // ------------------------------------------------------------------
    // 1. Mutlu yol
    // ------------------------------------------------------------------

    function test_HappyPath_YesWins() public {
        uint256 id = _create();
        _bet(alice, id, true, 100e6);
        _bet(bob, id, false, 300e6);

        _proposeAndFinalize(id, YES);

        PredictionMarket.Market memory m = pm.getMarket(id);
        assertEq(uint8(m.status), uint8(PredictionMarket.Status.Finalized));
        assertEq(uint8(m.finalOutcome), uint8(YES));
        assertEq(m.evidenceHash, EVIDENCE);

        uint256 fee = 400e6 * 100 / 10_000; // %1
        assertEq(m.fee, fee);
        assertEq(usdc.balanceOf(treasury), fee);

        assertEq(pm.previewPayout(id, alice), 400e6 - fee);
        assertEq(_claim(alice, id), 400e6 - fee);

        vm.prank(bob);
        vm.expectRevert(PredictionMarket.NothingToClaim.selector);
        pm.claim(id);

        assertEq(usdc.balanceOf(address(pm)), 0);
    }

    // ------------------------------------------------------------------
    // 2. Tek taraflı market → Void → iade
    // ------------------------------------------------------------------

    function test_OneSidedMarket_Voids() public {
        uint256 id = _create();
        _bet(alice, id, true, 50e6);
        _bet(bob, id, true, 70e6);

        _proposeAndFinalize(id, YES);

        assertEq(uint8(pm.getMarket(id).finalOutcome), uint8(VOID));
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(_claim(alice, id), 50e6);
        assertEq(_claim(bob, id), 70e6);
    }

    // ------------------------------------------------------------------
    // 3. Önerilen kazanan taraf boş → Void
    // ------------------------------------------------------------------

    function test_WinningSideEmpty_Voids() public {
        uint256 id = _create();
        _bet(alice, id, false, 40e6);

        _proposeAndFinalize(id, YES);

        assertEq(uint8(pm.getMarket(id).finalOutcome), uint8(VOID));
        assertEq(_claim(alice, id), 40e6);
    }

    // ------------------------------------------------------------------
    // 4. closeTime sonrası bet revert
    // ------------------------------------------------------------------

    function test_BetAfterClose_Reverts() public {
        uint256 id = _create();
        vm.warp(CLOSE);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.BettingClosed.selector);
        pm.bet(id, true, 10e6);
    }

    function test_BetBelowMin_Reverts() public {
        uint256 id = _create();
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.BetTooSmall.selector);
        pm.bet(id, true, 1e6 - 1);
    }

    // ------------------------------------------------------------------
    // 5. Erken öneri ve agent dışı öneri revert
    // ------------------------------------------------------------------

    function test_ProposeBeforeResolveTime_Reverts() public {
        uint256 id = _create();
        vm.warp(RESOLVE - 1);
        vm.prank(agent);
        vm.expectRevert(PredictionMarket.TooEarly.selector);
        pm.proposeResolution(id, YES, EVIDENCE, "");
    }

    function test_ProposeByNonAgent_Reverts() public {
        uint256 id = _create();
        vm.warp(RESOLVE);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.NotAgent.selector);
        pm.proposeResolution(id, YES, EVIDENCE, "");
    }

    function test_CreateByNonAgent_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.NotAgent.selector);
        pm.createMarket(1, PARAMS, "q", "", CLOSE, RESOLVE);
    }

    function test_CreateValidation() public {
        vm.startPrank(agent);
        vm.expectRevert(PredictionMarket.InvalidTemplate.selector);
        pm.createMarket(0, PARAMS, "q", "", CLOSE, RESOLVE);
        vm.expectRevert(PredictionMarket.InvalidTemplate.selector);
        pm.createMarket(6, PARAMS, "q", "", CLOSE, RESOLVE);
        vm.expectRevert(PredictionMarket.EmptyParams.selector);
        pm.createMarket(1, "", "q", "", CLOSE, RESOLVE);
        vm.expectRevert(PredictionMarket.InvalidTimes.selector);
        pm.createMarket(1, PARAMS, "q", "", T0, RESOLVE); // closeTime geçmişte
        vm.expectRevert(PredictionMarket.InvalidTimes.selector);
        pm.createMarket(1, PARAMS, "q", "", CLOSE, CLOSE + 119); // minResolveGap < 120
        vm.stopPrank();
    }

    function test_ProposeUnresolvedOrEmptyEvidence_Reverts() public {
        uint256 id = _create();
        vm.warp(RESOLVE);
        vm.startPrank(agent);
        vm.expectRevert(PredictionMarket.InvalidOutcome.selector);
        pm.proposeResolution(id, PredictionMarket.Outcome.Unresolved, EVIDENCE, "");
        vm.expectRevert(PredictionMarket.EmptyEvidence.selector);
        pm.proposeResolution(id, YES, bytes32(0), "");
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // 6. İtiraz akışı
    // ------------------------------------------------------------------

    function test_Dispute_Overturned_BondRefunded() public {
        uint256 id = _create();
        _bet(alice, id, true, 100e6);
        _bet(bob, id, false, 100e6);
        _propose(id, YES);

        uint256 carolBefore = usdc.balanceOf(carol);
        vm.prank(carol);
        pm.dispute(id);
        assertEq(uint8(pm.getMarket(id).status), uint8(PredictionMarket.Status.Disputed));
        assertEq(usdc.balanceOf(carol), carolBefore - pm.disputeBond());

        // Disputed iken finalize edilemez
        vm.warp(RESOLVE + pm.disputeWindow());
        vm.expectRevert(PredictionMarket.WrongStatus.selector);
        pm.finalize(id);

        vm.prank(owner);
        pm.resolveDispute(id, NO);

        assertEq(uint8(pm.getMarket(id).finalOutcome), uint8(NO));
        assertEq(usdc.balanceOf(carol), carolBefore); // teminat iade
        assertEq(_claim(bob, id), 200e6 - 2e6);
    }

    function test_Dispute_Upheld_BondToTreasury() public {
        uint256 id = _create();
        _bet(alice, id, true, 100e6);
        _bet(bob, id, false, 100e6);
        _propose(id, YES);

        vm.prank(carol);
        pm.dispute(id);

        vm.prank(owner);
        pm.resolveDispute(id, YES);

        // ücret (2e6) + teminat (10e6)
        assertEq(usdc.balanceOf(treasury), 2e6 + pm.disputeBond());
        assertEq(_claim(alice, id), 198e6);
    }

    function test_DisputeAfterWindow_Reverts() public {
        uint256 id = _create();
        _bet(alice, id, true, 10e6);
        _propose(id, YES);
        vm.warp(RESOLVE + pm.disputeWindow());
        vm.prank(carol);
        vm.expectRevert(PredictionMarket.TooLate.selector);
        pm.dispute(id);
    }

    function test_ResolveDispute_OnlyOwner() public {
        uint256 id = _create();
        _bet(alice, id, true, 10e6);
        _propose(id, YES);
        vm.prank(carol);
        pm.dispute(id);
        vm.prank(agent);
        vm.expectRevert();
        pm.resolveDispute(id, NO);
    }

    function test_FinalizeBeforeWindow_Reverts() public {
        uint256 id = _create();
        _bet(alice, id, true, 10e6);
        _propose(id, YES);
        vm.expectRevert(PredictionMarket.TooEarly.selector);
        pm.finalize(id);
    }

    // ------------------------------------------------------------------
    // 7. Çift claim revert
    // ------------------------------------------------------------------

    function test_DoubleClaim_Reverts() public {
        uint256 id = _create();
        _bet(alice, id, true, 100e6);
        _bet(bob, id, false, 100e6);
        _proposeAndFinalize(id, YES);

        _claim(alice, id);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.AlreadyClaimed.selector);
        pm.claim(id);
        assertEq(pm.previewPayout(id, alice), 0);
    }

    function test_ClaimBeforeFinalize_Reverts() public {
        uint256 id = _create();
        _bet(alice, id, true, 100e6);
        _propose(id, YES);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.WrongStatus.selector);
        pm.claim(id);
    }

    // ------------------------------------------------------------------
    // 8. voidStale
    // ------------------------------------------------------------------

    function test_VoidStale_AfterDeadline() public {
        uint256 id = _create();
        _bet(alice, id, true, 30e6);
        _bet(bob, id, false, 20e6);

        vm.warp(uint256(RESOLVE) + pm.proposeDeadline());
        vm.expectRevert(PredictionMarket.TooEarly.selector);
        pm.voidStale(id);

        vm.warp(uint256(RESOLVE) + pm.proposeDeadline() + 1);
        vm.prank(carol);
        pm.voidStale(id);

        assertEq(uint8(pm.getMarket(id).finalOutcome), uint8(VOID));
        assertEq(_claim(alice, id), 30e6);
        assertEq(_claim(bob, id), 20e6);
    }

    // ------------------------------------------------------------------
    // 9. Ücret ve yuvarlama (fuzz)
    // ------------------------------------------------------------------

    function testFuzz_PayoutsNeverExceedPool(uint96 a, uint96 b, uint96 c, uint96 d, bool yesWins) public {
        uint256 aa = bound(a, 1e6, 5_000e6);
        uint256 bb = bound(b, 1e6, 5_000e6);
        uint256 cc = bound(c, 1e6, 5_000e6);
        uint256 dd = bound(d, 1e6, 5_000e6);

        uint256 id = _create();
        _bet(alice, id, true, aa);
        _bet(bob, id, true, bb);
        _bet(carol, id, false, cc);
        _bet(agent, id, false, dd);

        _proposeAndFinalize(id, yesWins ? YES : NO);

        uint256 total = aa + bb + cc + dd;
        uint256 fee = total * 100 / 10_000;
        assertEq(usdc.balanceOf(treasury), fee);

        uint256 paid;
        if (yesWins) {
            paid += _claim(alice, id);
            paid += _claim(bob, id);
            assertEq(pm.previewPayout(id, alice), 0);
        } else {
            paid += _claim(carol, id);
            paid += _claim(agent, id);
        }

        assertLe(paid, total - fee);
        // yuvarlama tozu, kazanan sayısından fazla olamaz
        assertLe(total - fee - paid, 2);
        assertEq(usdc.balanceOf(address(pm)), total - fee - paid);
    }

    // ------------------------------------------------------------------
    // 10. Pause
    // ------------------------------------------------------------------

    function test_Pause_BlocksCreateAndBet_NotClaim() public {
        uint256 id = _create();
        _bet(alice, id, true, 100e6);
        _bet(bob, id, false, 100e6);

        vm.prank(owner);
        pm.pause();

        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pm.createMarket(1, PARAMS, "q", "", CLOSE, RESOLVE);

        vm.prank(carol);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pm.bet(id, true, 10e6);

        // Kullanıcı fonları kilitlenmez: çözüm ve claim devam eder
        _proposeAndFinalize(id, YES);
        assertEq(_claim(alice, id), 198e6);

        vm.prank(owner);
        pm.unpause();
        uint64 nowTs = uint64(block.timestamp);
        vm.prank(agent);
        pm.createMarket(1, PARAMS, "q", "", nowTs + 600, nowTs + 900);
    }

    // ------------------------------------------------------------------
    // Ek: owner parametreleri, faucet
    // ------------------------------------------------------------------

    function test_SetParams_FeeCap() public {
        vm.prank(owner);
        vm.expectRevert(PredictionMarket.InvalidParams.selector);
        pm.setParams(1_001, 300, 120, 2 hours, 10e6, 1e6);

        vm.prank(alice);
        vm.expectRevert();
        pm.setParams(100, 300, 120, 2 hours, 10e6, 1e6);
    }

    function test_UnknownMarket_Reverts() public {
        vm.expectRevert(PredictionMarket.UnknownMarket.selector);
        pm.getMarket(1);
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.UnknownMarket.selector);
        pm.bet(0, true, 1e6);
    }

    function test_Faucet_Cooldown() public {
        address dave = makeAddr("dave");
        vm.prank(dave);
        usdc.faucet();
        assertEq(usdc.balanceOf(dave), 1_000e6);

        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.FaucetCooldown.selector, T0 + 1 hours));
        usdc.faucet();

        vm.warp(T0 + 1 hours);
        vm.prank(dave);
        usdc.faucet();
        assertEq(usdc.balanceOf(dave), 2_000e6);
    }
}
