use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use crate::errors::ErrorCode;

pub const VOTE_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("Vote111111111111111111111111111111111111111");
pub const INCINERATOR: Pubkey =
    Pubkey::from_str_const("1nc1nerator11111111111111111111111111111111");

/// VoteStateV4 header fields used by the program (fixed bincode offsets, LE).
pub struct VoteHeader {
    pub node_pubkey: Pubkey,
    pub authorized_withdrawer: Pubkey,
    pub inflation_rewards_collector: Pubkey,
    pub pending_delegator_rewards: u64,
    pub has_bls: bool,
}

/// tag u32 @0 == 3; node @4; withdrawer @36; collector @68; pending @136; bls tag @144.
pub fn parse_v4_header(data: &[u8]) -> Result<VoteHeader> {
    require!(data.len() >= 145, ErrorCode::NotV4);
    let tag = u32::from_le_bytes(data[0..4].try_into().unwrap());
    require!(tag == 3, ErrorCode::NotV4);
    Ok(VoteHeader {
        node_pubkey: Pubkey::try_from(&data[4..36]).unwrap(),
        authorized_withdrawer: Pubkey::try_from(&data[36..68]).unwrap(),
        inflation_rewards_collector: Pubkey::try_from(&data[68..100]).unwrap(),
        pending_delegator_rewards: u64::from_le_bytes(data[136..144].try_into().unwrap()),
        has_bls: data[144] == 1,
    })
}

/// VoteInstruction::Withdraw(lamports) => [3,0,0,0] ++ u64le
pub fn withdraw_ix(vote: Pubkey, recipient: Pubkey, withdrawer: Pubkey, lamports: u64) -> Instruction {
    let mut data = Vec::with_capacity(12);
    data.extend_from_slice(&3u32.to_le_bytes());
    data.extend_from_slice(&lamports.to_le_bytes());
    Instruction {
        program_id: VOTE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(vote, false),
            AccountMeta::new(recipient, false),
            AccountMeta::new_readonly(withdrawer, true),
        ],
        data,
    }
}

/// VoteInstruction::Authorize(new, VoteAuthorize::Withdrawer)
/// => [1,0,0,0] ++ pubkey ++ [1,0,0,0]
pub fn authorize_withdrawer_ix(
    vote: Pubkey,
    withdrawer: Pubkey,
    new_withdrawer: Pubkey,
) -> Instruction {
    let mut data = Vec::with_capacity(40);
    data.extend_from_slice(&1u32.to_le_bytes());
    data.extend_from_slice(new_withdrawer.as_ref());
    data.extend_from_slice(&1u32.to_le_bytes());
    Instruction {
        program_id: VOTE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(vote, false),
            AccountMeta::new_readonly(Pubkey::from_str_const("SysvarC1ock11111111111111111111111111111111"), false),
            AccountMeta::new_readonly(withdrawer, true),
        ],
        data,
    }
}
