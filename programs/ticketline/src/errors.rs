use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Invalid vote account (wrong owner or wrong address)")]
    InvalidVoteAccount,
    #[msg("Vote account is not VoteStateV4")]
    NotV4,
    #[msg("Vote account authorized_withdrawer is not the program auth PDA")]
    WithdrawerNotPda,
    #[msg("Signer is not the vote account node identity")]
    NotNodeIdentity,
    #[msg("Vote account has no BLS key")]
    NoBls,
    #[msg("inflation_rewards_collector is not the vote account")]
    CollectorNotVoteAccount,
    #[msg("Deposit minted zero LP shares")]
    ZeroShares,
    #[msg("Pool has insufficient available liquidity")]
    PoolIlliquid,
    #[msg("Position already topped up this epoch")]
    AlreadyToppedUpThisEpoch,
    #[msg("Vote account has no deficit")]
    NoDeficit,
    #[msg("Top-up would exceed the position credit limit")]
    CreditExceeded,
    #[msg("Nothing to sweep")]
    NothingToSweep,
    #[msg("Position still has outstanding debt")]
    DebtOutstanding,
    #[msg("Amount exceeds withdrawable surplus")]
    ExceedsSurplus,
    #[msg("Operation would breach the vote account reserve (rent + pending rewards)")]
    InsufficientHeadroom,
}
