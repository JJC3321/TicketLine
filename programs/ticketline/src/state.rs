use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub admin: Pubkey,
    pub oracle: Pubkey,
    pub lp_mint: Pubkey,
    pub fee_bps: u16,
    pub ticket_lamports: u64,
    pub buffer_lamports: u64,
    pub default_credit_tickets: u8,
    pub total_principal: u64,
    pub total_fees_outstanding: u64,
    pub total_fees_earned: u64,
    pub total_topups: u64,
    pub bump: u8,
    pub vault_bump: u8,
    pub lp_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub vote_account: Pubkey,
    pub owner: Pubkey,
    pub payout: Pubkey,
    pub principal: u64,
    pub fees: u64,
    pub credit_limit: u64,
    pub topups: u32,
    pub last_topup_epoch: u64,
    pub enrolled_epoch: u64,
    pub total_repaid: u64,
    pub bump: u8,
    pub auth_bump: u8,
}
