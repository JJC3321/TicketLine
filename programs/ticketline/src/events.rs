use anchor_lang::prelude::*;

#[event]
pub struct Deposited {
    pub lender: Pubkey,
    pub lamports: u64,
    pub shares: u64,
}

#[event]
pub struct Withdrawn {
    pub lender: Pubkey,
    pub shares: u64,
    pub lamports: u64,
}

#[event]
pub struct Enrolled {
    pub vote_account: Pubkey,
    pub owner: Pubkey,
    pub payout: Pubkey,
    pub credit_limit: u64,
    pub epoch: u64,
}

#[event]
pub struct CreditLimitSet {
    pub vote_account: Pubkey,
    pub credit_limit: u64,
}

#[event]
pub struct TopUp {
    pub vote_account: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub epoch: u64,
    pub principal: u64,
    pub fees: u64,
}

#[event]
pub struct Sweep {
    pub vote_account: Pubkey,
    pub repaid: u64,
    pub fee_part: u64,
    pub principal_part: u64,
    pub epoch: u64,
    pub principal: u64,
    pub fees: u64,
}

#[event]
pub struct SurplusWithdrawn {
    pub vote_account: Pubkey,
    pub payout: Pubkey,
    pub lamports: u64,
}

#[event]
pub struct Exited {
    pub vote_account: Pubkey,
    pub new_withdrawer: Pubkey,
}

#[event]
pub struct SimTicketBurn {
    pub vote_account: Pubkey,
    pub lamports: u64,
    pub epoch: u64,
}
