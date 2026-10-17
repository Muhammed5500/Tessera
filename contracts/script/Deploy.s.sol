// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";

/// @notice MockUSDC → PredictionMarket → agent'a 10.000 kUSDC. Adresleri deployments/<ağ>.json'a yazar.
/// Env: DEPLOYER_PRIVATE_KEY, AGENT_ADDRESS, (opsiyonel) TREASURY_ADDRESS
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address agentAddr = vm.envAddress("AGENT_ADDRESS");
        address treasuryAddr = vm.envOr("TREASURY_ADDRESS", deployer);

        vm.startBroadcast(pk);
        MockUSDC usdc = new MockUSDC(deployer);
        PredictionMarket pm = new PredictionMarket(usdc, agentAddr, treasuryAddr, deployer);
        usdc.mint(agentAddr, 10_000e6);
        vm.stopBroadcast();

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "usdc", address(usdc));
        vm.serializeAddress(obj, "pm", address(pm));
        vm.serializeAddress(obj, "agent", agentAddr);
        vm.serializeAddress(obj, "owner", deployer);
        vm.serializeAddress(obj, "treasury", treasuryAddr);
        string memory json = vm.serializeUint(obj, "deployBlock", block.number);

        string memory name = block.chainid == 43113 ? "fuji" : "local";
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", name, ".json");
        vm.writeJson(json, path);

        console2.log("MockUSDC        ", address(usdc));
        console2.log("PredictionMarket", address(pm));
        console2.log("written to      ", path);
    }
}
