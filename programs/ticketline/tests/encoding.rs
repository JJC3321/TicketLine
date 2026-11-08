// encoding.rs: hand-built vote ix bytes == solana-vote-interface builders;
// vote.rs parser fields == serialized VoteStateV4 (Invariant: encodings correct).
mod common;
use common::*;
use solana_vote_interface::{
    instruction as vote_instruction,
    state::{vote_state_v4::VoteStateV4, vote_state_versions::VoteStateVersions, VoteAuthorize},
};

#[test]
fn withdraw_encoding_matches_crate() {
    let vote = Pubkey::new_unique();
    let to = Pubkey::new_unique();
    let auth = Pubkey::new_unique();
    let ours = ticketline::vote::withdraw_ix(vote, to, auth, 123_456_789);
    let theirs = vote_instruction::withdraw(&vote, &auth, 123_456_789, &to);
    assert_eq!(ours.data, theirs.data);
    assert_eq!(ours.accounts, theirs.accounts);
    assert_eq!(ours.program_id, theirs.program_id);
    // literal form from plan section 5.2
    let mut want = vec![3u8, 0, 0, 0];
    want.extend_from_slice(&123_456_789u64.to_le_bytes());
    assert_eq!(ours.data, want);
}

#[test]
fn authorize_withdrawer_encoding_matches_crate() {
    let vote = Pubkey::new_unique();
    let auth = Pubkey::new_unique();
    let new = Pubkey::new_unique();
    let ours = ticketline::vote::authorize_withdrawer_ix(vote, auth, new);
    let theirs = vote_instruction::authorize(&vote, &auth, &new, VoteAuthorize::Withdrawer);
    assert_eq!(ours.data, theirs.data);
    assert_eq!(ours.accounts, theirs.accounts);
    let mut want = vec![1u8, 0, 0, 0];
    want.extend_from_slice(new.as_ref());
    want.extend_from_slice(&1u32.to_le_bytes());
    assert_eq!(ours.data, want);
}

#[test]
fn parser_reads_serialized_v4() {
    let node = Pubkey::new_unique();
    let wd = Pubkey::new_unique();
    let coll = Pubkey::new_unique();
    let pending = 42_000_000u64;
    let vs = VoteStateV4 {
        node_pubkey: node,
        authorized_withdrawer: wd,
        inflation_rewards_collector: coll,
        pending_delegator_rewards: pending,
        bls_pubkey_compressed: Some([7u8; 48]),
        ..Default::default()
    };
    let mut data = vec![0u8; VoteStateV4::size_of()];
    VoteStateV4::serialize(&VoteStateVersions::V4(Box::new(vs)), &mut data).unwrap();
    let h = ticketline::vote::parse_v4_header(&data).unwrap();
    assert_eq!(h.node_pubkey, node);
    assert_eq!(h.authorized_withdrawer, wd);
    assert_eq!(h.inflation_rewards_collector, coll);
    assert_eq!(h.pending_delegator_rewards, pending);
    assert!(h.has_bls);
}

#[test]
fn parser_rejects_bad_input() {
    // tag != 3
    let vs = VoteStateV4 { bls_pubkey_compressed: None, ..Default::default() };
    let mut data = vec![0u8; VoteStateV4::size_of()];
    VoteStateV4::serialize(&VoteStateVersions::V4(Box::new(vs)), &mut data).unwrap();
    data[0] = 2; // V3 tag
    assert!(ticketline::vote::parse_v4_header(&data).is_err());
    // short buffer
    assert!(ticketline::vote::parse_v4_header(&data[..144]).is_err());
    // bls absent
    data[0] = 3;
    let h = ticketline::vote::parse_v4_header(&data).unwrap();
    assert!(!h.has_bls);
}
