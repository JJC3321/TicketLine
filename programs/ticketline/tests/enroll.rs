// enroll.rs: happy path; rejects wrong withdrawer, no BLS, collector != vote,
// signer != node identity, non-V4.
mod common;
use common::*;

fn setup() -> (LiteSVM, Keypair) {
    let mut s = svm();
    let admin = funded(&mut s, 10_000_000_000);
    init_pool(&mut s, &admin, Pubkey::new_unique());
    (s, admin)
}

#[test]
fn enroll_happy_path() {
    let (mut s, _a) = setup();
    let node = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    put_vote_account(&mut s, &vote_cfg(vote, node.pubkey(), auth, 10_000_000_000));
    let payout = Pubkey::new_unique();
    enroll(&mut s, &node, &vote, payout).unwrap();

    let pos = position_state(&s, &vote);
    assert_eq!(pos.vote_account, vote);
    assert_eq!(pos.owner, node.pubkey());
    assert_eq!(pos.payout, payout);
    assert_eq!(pos.credit_limit, (CREDIT_TICKETS as u64) * TICKET);
    assert_eq!(pos.last_topup_epoch, u64::MAX);
    assert_eq!(pos.principal, 0);
    assert_eq!(pos.fees, 0);
}

#[test]
fn enroll_rejects_wrong_withdrawer() {
    let (mut s, _a) = setup();
    let node = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    put_vote_account(
        &mut s,
        &vote_cfg(vote, node.pubkey(), Pubkey::new_unique(), 10_000_000_000),
    );
    let r = enroll(&mut s, &node, &vote, Pubkey::new_unique());
    assert!(r.is_err(), "withdrawer != auth PDA must fail");
}

#[test]
fn enroll_rejects_missing_bls() {
    let (mut s, _a) = setup();
    let node = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    let mut cfg = vote_cfg(vote, node.pubkey(), auth, 10_000_000_000);
    cfg.bls = false;
    put_vote_account(&mut s, &cfg);
    let r = enroll(&mut s, &node, &vote, Pubkey::new_unique());
    assert!(r.is_err(), "no BLS must fail");
}

#[test]
fn enroll_rejects_wrong_collector() {
    let (mut s, _a) = setup();
    let node = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    let mut cfg = vote_cfg(vote, node.pubkey(), auth, 10_000_000_000);
    cfg.collector = Pubkey::new_unique();
    put_vote_account(&mut s, &cfg);
    let r = enroll(&mut s, &node, &vote, Pubkey::new_unique());
    assert!(r.is_err(), "collector != vote must fail");
}

#[test]
fn enroll_rejects_non_node_signer() {
    let (mut s, _a) = setup();
    let node = funded(&mut s, 1_000_000_000);
    let impostor = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    put_vote_account(&mut s, &vote_cfg(vote, node.pubkey(), auth, 10_000_000_000));
    let r = enroll(&mut s, &impostor, &vote, Pubkey::new_unique());
    assert!(r.is_err(), "signer != node_pubkey must fail");
}

#[test]
fn enroll_rejects_non_v4() {
    let (mut s, _a) = setup();
    let node = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    // zeroed account owned by vote program -> tag 0 -> NotV4
    s.set_account(
        vote,
        solana_account::Account {
            lamports: 10_000_000_000,
            data: vec![0u8; 3762],
            owner: VOTE_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    let r = enroll(&mut s, &node, &vote, Pubkey::new_unique());
    assert!(r.is_err(), "non-V4 must fail");
}
