import { Container, Spinner } from "react-bootstrap";

// Shown only until the very first connection of a page load. Retrying is
// driven by App.tsx (the same loop also serves the reconnect overlay), so
// this is just the picture.
const WaitingPage = () => {
  return (
    <Container style={{marginTop: "24px"}}>
      <h1>Establishing connection</h1>
      <div>Trying to establish connection to UGS <Spinner animation="border" variant="primary" size="sm" /></div>
    </Container>
  );
};

export default WaitingPage;
